"use strict";

const db = require("../tools/database");

const INSERT_PRINT_LOG_SQL =
  "INSERT INTO print_logs (socketId, clientType, printer, templateId, data, pageNum, status, rePrintAble, errorMessage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

function serializePrintData(data, options = {}) {
  const logData = options.omitPdfBlob ? { ...data } : data;
  if (
    options.omitPdfBlob &&
    Object.prototype.hasOwnProperty.call(logData, "pdf_blob")
  ) {
    logData.pdf_blob = "[omitted]";
  }
  return JSON.stringify(logData);
}

function writePrintLog({
  socketId,
  clientType,
  printer,
  templateId,
  data,
  pageNum,
  status,
  rePrintAble,
  errorMessage = "",
  omitPdfBlob = false,
}) {
  db.run(
    INSERT_PRINT_LOG_SQL,
    [
      socketId,
      clientType,
      printer,
      templateId,
      serializePrintData(data, { omitPdfBlob }),
      pageNum,
      status,
      rePrintAble ?? 1,
      errorMessage,
    ],
    (err) => {
      if (err) {
        console.error("Failed to log print result", err);
      }
    },
  );
}

module.exports = { writePrintLog };
