/*
 * @Description: pdf打印
 * @Author: CcSimple
 * @Github: https://github.com/CcSimple
 * @Date: 2023-04-21 16:35:07
 * @LastEditors: JZT.吴健
 * @LastEditTime: 2025-09-26 14:10:48
 */
const pdfPrint1 = require("pdf-to-printer");
const pdfPrint2 = require("unix-print");
const path = require("path");
const fs = require("fs");
const os = require("os");
const dns = require("dns");
const {
  store,
  getHttpUrlTargetError,
  isBlockedIPv4,
  isBlockedIPv6,
} = require("../tools/utils");
const dayjs = require("dayjs");
const { v7: uuidv7 } = require("uuid");

const printPdfFunction =
  process.platform === "win32" ? pdfPrint1.print : pdfPrint2.print;

/**
 * @description: 净化 unix `lp` 打印选项，仅放行安全 token，
 *   过滤掉可能用于命令注入的 shell 元字符（空格、引号、; & | ` $ < > 等）。
 * @param {unknown} options 对端可控的打印选项数组
 * @return {string[]} 过滤后的安全选项
 */
const sanitizeUnixPrintOptions = (options) => {
  if (!Array.isArray(options)) return [];
  const SAFE_TOKEN = /^[A-Za-z0-9._\-=,:+/]+$/;
  return options.filter(
    (option) => typeof option === "string" && SAFE_TOKEN.test(option),
  );
};

const realPrint = (pdfPath, printer, data, resolve, reject) => {
  if (!fs.existsSync(pdfPath)) {
    reject({ path: pdfPath, msg: "file not found" });
    return;
  }

  if (process.platform === "win32") {
    data = Object.assign({}, data);
    data.printer = printer;
    console.log("print pdf:" + pdfPath + JSON.stringify(data));
    // 参数见 node_modules/pdf-to-printer/dist/print/print.d.ts
    // pdf打印文档：https://www.sumatrapdfreader.org/docs/Command-line-arguments
    // pdf-to-printer 源码: https://github.com/artiebits/pdf-to-printer
    let pdfOptions = Object.assign(data, { paperSize: data.paperName });
    printPdfFunction(pdfPath, pdfOptions)
      .then(() => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  } else {
    // 参数见 lp 命令 使用方法；对端传入的 lp 选项必须净化，防止命令注入
    printPdfFunction(
      pdfPath,
      printer,
      sanitizeUnixPrintOptions(data.unixPrintOptions),
    )
      .then(() => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  }
};

const printPdf = (pdfPath, printer, data) => {
  return new Promise((resolve, reject) => {
    try {
      if (typeof pdfPath !== "string") {
        reject("pdfPath must be a string");
      }
      if (/^https?:\/\/.+/.test(pdfPath)) {
        // SSRF 防护：对端可控的 url_pdf 地址先校验协议与字面量主机，
        // 拒绝 localhost / 内网 / 保留地址（如 169.254.169.254 云元数据）。
        const urlError = getHttpUrlTargetError(pdfPath);
        if (urlError) {
          reject(urlError);
          return;
        }
        const { hostname } = new URL(pdfPath);
        // 防 DNS 重绑定：连接前再校验域名解析后的实际 IP 不指向内网/保留地址。
        dns.lookup(hostname, { all: true }, (lookupErr, addresses) => {
          if (lookupErr) {
            reject(lookupErr);
            return;
          }
          const blocked = (addresses || []).find(
            (addr) =>
              (addr.family === 4 && isBlockedIPv4(addr.address)) ||
              (addr.family === 6 && isBlockedIPv6(addr.address)),
          );
          if (blocked) {
            reject(new Error("下载地址解析到内网地址，已拒绝"));
            return;
          }
          const client = pdfPath.startsWith("https")
            ? require("https")
            : require("http");
          client
            .get(pdfPath, (res) => {
              // 非 200 直接拒绝，避免把错误页 / 空响应当作 PDF 送打印
              if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`下载 PDF 失败：HTTP ${res.statusCode}`));
                return;
              }
              const toSavePath = path.join(
                store.get("pdfPath") || os.tmpdir(),
                "url_pdf",
                dayjs().format(`YYYY_MM_DD HH_mm_ss_`) + `${uuidv7()}.pdf`,
              );
              // 确保目录存在
              fs.mkdirSync(path.dirname(toSavePath), { recursive: true });
              const file = fs.createWriteStream(toSavePath);
              // 写盘失败（磁盘满等）清理半成品文件，避免把损坏文件送打印
              file.on("error", (fileErr) => {
                fs.unlink(toSavePath, () => {});
                console.log("save url pdf error:" + fileErr?.message);
                reject(fileErr);
              });
              res.pipe(file);
              file.on("finish", () => {
                file.close(() => {
                  console.log("file downloaded:" + toSavePath);
                  realPrint(toSavePath, printer, data, resolve, reject);
                });
              });
            })
            .on("error", (err) => {
              console.log("download pdf error:" + err?.message);
              reject(err);
            });
        });
        return;
      }
      realPrint(pdfPath, printer, data, resolve, reject);
    } catch (error) {
      console.log("print error:" + error?.message);
      reject(error);
    }
  });
};

/**
 * @description: 打印Blob类型的PDF数据
 * @param {Blob|Uint8Array|Buffer} pdfBlob PDF的二进制数据
 * @param {string} printer 打印机名称
 * @param {object} data 打印参数
 * @return {Promise}
 */
const printPdfBlob = (pdfBlob, printer, data) => {
  return new Promise((resolve, reject) => {
    try {
      // 验证blob数据 实际是 Uint8Array
      if (
        !pdfBlob ||
        !(pdfBlob instanceof Uint8Array || Buffer.isBuffer(pdfBlob))
      ) {
        reject(new Error("pdfBlob must be a Uint8Array, Buffer"));
        return;
      }

      // 生成临时文件路径
      const toSavePath = path.join(
        store.get("pdfPath") || os.tmpdir(),
        "blob_pdf",
        dayjs().format(`YYYY_MM_DD HH_mm_ss_`) + `${uuidv7()}.pdf`,
      );

      // 确保目录存在
      fs.mkdirSync(path.dirname(toSavePath), { recursive: true });

      // Uint8Array 2 Buffer
      const buffer = Buffer.isBuffer(pdfBlob) ? pdfBlob : Buffer.from(pdfBlob);

      // 写入文件
      fs.writeFile(toSavePath, buffer, (err) => {
        if (err) {
          console.log("save blob pdf error:" + err?.message);
          reject(err);
          return;
        }

        console.log("blob pdf saved:" + toSavePath);

        // 调用打印函数
        realPrint(toSavePath, printer, data, resolve, reject);
      });
    } catch (error) {
      console.log("print blob error:" + error?.message);
      reject(error);
    }
  });
};

module.exports = {
  printPdf,
  printPdfBlob,
};
