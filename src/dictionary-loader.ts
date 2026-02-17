import * as fs from "fs";
import * as path from "path";

interface LoadedDictionary {
  groups: Record<string, string>;
  headings: Record<string, string>;
  headingDetails: Record<string, { description: string; type?: string; unit?: string; status?: string; example?: string }>;
}

const dictionaryCache = new Map<string, LoadedDictionary>();

/**
 * Load an AGS dictionary from the bundled JSON files
 */
export function loadDictionary(version: string, extensionPath: string): LoadedDictionary {
  const cacheKey = version;

  if (dictionaryCache.has(cacheKey)) {
    return dictionaryCache.get(cacheKey)!;
  }

  const fileName = `ags-dictionary-v${version}.min.json`;
  const filePath = path.join(extensionPath, "data", fileName);

  if (!fs.existsSync(filePath)) {
    const fallbackPath = path.join(extensionPath, "data", "ags-dictionary-v4.1.1.min.json");
    if (!fs.existsSync(fallbackPath)) {
      return { groups: {}, headings: {}, headingDetails: {} };
    }
    return loadDictionaryFromFile(fallbackPath, cacheKey);
  }

  return loadDictionaryFromFile(filePath, cacheKey);
}

function loadDictionaryFromFile(filePath: string, cacheKey: string): LoadedDictionary {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as Array<{
      GROUP: string;
      HEADING: string[];
      UNIT: string[];
      TYPE: string[];
      DATA: string[][];
    }>;

    const groups: Record<string, string> = {};
    const headings: Record<string, string> = {};
    const headingDetails: Record<string, { description: string; type?: string; unit?: string; status?: string; example?: string }> = {};

    // Find the DICT group which contains all definitions
    const dictGroup = data.find((g) => g.GROUP === "DICT");

    if (dictGroup) {
      // Get column indices
      const headingRow = dictGroup.HEADING;
      const typeIdx = headingRow.indexOf("DICT_TYPE");
      const grpIdx = headingRow.indexOf("DICT_GRP");
      const hdngIdx = headingRow.indexOf("DICT_HDNG");
      const descIdx = headingRow.indexOf("DICT_DESC");
      const statIdx = headingRow.indexOf("DICT_STAT");
      const dtypIdx = headingRow.indexOf("DICT_DTYP");
      const unitIdx = headingRow.indexOf("DICT_UNIT");
      const exmpIdx = headingRow.indexOf("DICT_EXMP");

      for (const row of dictGroup.DATA) {
        const dictType = row[typeIdx];
        const groupCode = row[grpIdx];
        const headingCode = row[hdngIdx];
        const description = row[descIdx] || "";
        const status = row[statIdx] || "";
        const dataType = row[dtypIdx] || "";
        const unit = row[unitIdx] || "";
        const example = exmpIdx >= 0 ? (row[exmpIdx] || "") : "";

        if (dictType === "GROUP") {
          groups[groupCode] = description;
        } else if (dictType === "HEADING" && headingCode) {
          headings[headingCode] = description;
          headingDetails[headingCode] = {
            description,
            type: dataType,
            unit,
            status,
            example,
          };
        }
      }
    }

    const result = { groups, headings, headingDetails };
    dictionaryCache.set(cacheKey, result);
    return result;
  } catch (error) {
    return { groups: {}, headings: {}, headingDetails: {} };
  }
}

/**
 * Type descriptions (these don't change between versions)
 */
export const typeDescriptions: Record<string, string> = {
  ID: "Identifier - unique key field",
  X: "Text field",
  PA: "Pick list (abbreviation)",
  DT: "Date/Time",
  MC: "Memo/Comments",
  SF: "Scientific format number",
  SCI: "Scientific notation",
  DMS: "Degrees Minutes Seconds",
  T: "Time",
  U: "Units (legacy)",
  YN: "Yes/No",
  PU: "Pick Unit",
  PT: "Pick Type",
  DP: "Decimal places (variable)",
  "0DP": "0 decimal places",
  "1DP": "1 decimal place",
  "2DP": "2 decimal places",
  "3DP": "3 decimal places",
  "4DP": "4 decimal places",
  "5DP": "5 decimal places",
};
