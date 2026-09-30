import * as xlsx from "xlsx";
import { BadRequestError } from "../../domain/errors/app.error.js";

export interface ParsedExcelResult {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

const REQUIRED_HEADERS = ["id", "updatedat"];

export function parseExcelBuffer(buffer: Buffer): ParsedExcelResult {
  let workbook: xlsx.WorkBook;
  try {
    workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    throw new BadRequestError("Failed to parse Excel file. File may be corrupted or not a valid .xlsx file.");
  }

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new BadRequestError("The uploaded Excel workbook contains no sheets.");
  }

  const firstSheetName = sheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) {
    throw new BadRequestError("The uploaded Excel sheet is empty.");
  }

  // Inspect header row
  const sheetData = xlsx.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
  if (!sheetData || sheetData.length === 0) {
    throw new BadRequestError("The uploaded Excel sheet is completely empty.");
  }

  const rawHeaderRow = (sheetData[0] || []).map((c) => String(c).trim());
  const normalizedHeaders = rawHeaderRow.map((h) => h.toLowerCase());

  // Check required headers
  for (const reqHeader of REQUIRED_HEADERS) {
    if (!normalizedHeaders.includes(reqHeader)) {
      throw new BadRequestError(
        `Missing required header '${reqHeader}' in Excel sheet. Found headers: ${rawHeaderRow.join(", ")}`
      );
    }
  }

  // Convert to JSON objects
  const rawRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    raw: false,
    defval: "",
  });

  const normalizedRows: Record<string, unknown>[] = [];
  for (const row of rawRows) {
    const normRow: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      const lower = key.trim().toLowerCase();
      const mappedKey = lower === "updatedat" ? "updatedAt" : lower;
      normRow[mappedKey] = val;
    }
    normalizedRows.push(normRow);
  }

  return {
    sheetName: firstSheetName,
    headers: normalizedHeaders,
    rows: normalizedRows,
  };
}
