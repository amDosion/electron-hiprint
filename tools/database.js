const { app } = require("electron");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// 创建或打开数据库
let dbPath = path.join(__dirname, "database.sqlite");
if (app.isPackaged) {
  // 打包态：DB 存用户数据目录（可写、不随安装/升级被清除），
  // 而非安装目录 resources/（只读、卸载即丢、升级被覆盖）
  const userDbPath = path.join(app.getPath("userData"), "database.sqlite");
  const legacyDbPath = path.join(app.getAppPath(), "../", "database.sqlite");
  // 一次性迁移：旧安装目录已有数据且新位置尚无时复制过去（保留旧文件作备份，迁移失败不阻断启动）
  if (fs.existsSync(legacyDbPath) && !fs.existsSync(userDbPath)) {
    try {
      fs.copyFileSync(legacyDbPath, userDbPath);
      console.log("database migrated to userData:", userDbPath);
    } catch (err) {
      console.error("database migration failed", err);
    }
  }
  dbPath = userDbPath;
}
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Could not connect to database", err);
  } else {
    console.log("Connected to database");
  }
});

let schemaError = null;
let resolveSchemaReady;
let rejectSchemaReady;
const schemaReady = new Promise((resolve, reject) => {
  resolveSchemaReady = resolve;
  rejectSchemaReady = reject;
});

function isDuplicateColumnError(err) {
  return err && err.message && err.message.includes("duplicate column");
}

function recordSchemaError(err, options = {}) {
  if (!err) return;
  if (options.ignoreDuplicateColumn && isDuplicateColumnError(err)) return;
  if (!schemaError) {
    schemaError = err;
  }
}

function finishSchemaReady(err) {
  recordSchemaError(err);
  if (schemaError) {
    rejectSchemaReady(schemaError);
    return;
  }
  resolveSchemaReady();
}

// 创建打印日志记录表
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS print_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      socketId TEXT,
      clientType TEXT,
      printer TEXT,
      templateId TEXT,
      data TEXT,
      pageNum INTEGER,
      status TEXT,
      errorMessage TEXT
    )
  `, recordSchemaError);

  // 添加新的可选字段 rePrintAble，默认值为 1
  db.run(
    `
    ALTER TABLE print_logs ADD COLUMN rePrintAble INTEGER DEFAULT 1;
  `,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("添加新字段时出错:", err);
      }
      recordSchemaError(err, { ignoreDuplicateColumn: true });
    },
  );

  // 创建软件日志记录表（与打印日志统一落 sqlite；写入见 src/software-log-store.js）
  db.run(`
    CREATE TABLE IF NOT EXISTS software_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT,
      ts TEXT,
      level TEXT,
      msg TEXT
    )
  `, recordSchemaError);

  // 按天查询 / DISTINCT 列日期用索引（对齐软件日志窗口的日期选择）
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_software_logs_day ON software_logs(day)`,
    recordSchemaError,
  );
  // 软件日志窗口按 day 取末尾日志：WHERE day = ? ORDER BY id DESC LIMIT ?
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_software_logs_day_id ON software_logs(day, id DESC)`,
    recordSchemaError,
  );
  // 打印记录默认按最近记录展示，并被打印状态查询复用。
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_print_logs_timestamp_id ON print_logs(timestamp DESC, id DESC)`,
    recordSchemaError,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_print_logs_template_timestamp_id ON print_logs(templateId, timestamp DESC, id DESC)`,
    finishSchemaReady,
  );
});

db.getDatabasePath = () => dbPath;
db.whenReady = () => schemaReady;

module.exports = db;
