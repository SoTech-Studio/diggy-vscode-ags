import * as vscode from "vscode";
import { loadDictionary, typeDescriptions } from "./dictionary-loader";
import { AGSTableViewProvider, ParsedDocument, ParsedGroup } from "./table-view-provider";

// Status bar item for showing current column heading
let columnStatusBarItem: vscode.StatusBarItem;

// Status bar item for Diggy branding
let diggyStatusBarItem: vscode.StatusBarItem;

// Extension path for loading dictionaries
let extensionPath: string;

// Loaded dictionary (cached)
let dictionary: ReturnType<typeof loadDictionary>;

// Table view provider instance
let tableViewProvider: AGSTableViewProvider;

interface LocationInfo {
  id: string;
  type?: string;
  easting?: string;
  northing?: string;
  finalDepth?: string;
  depthMin?: number;
  depthMax?: number;
}

interface LocationTypeInfo {
  count: number;
  depthMin?: number;
  depthMax?: number;
}

interface AGSSummary {
  totalGroups: number;
  totalRecords: number;
  groupCounts: Array<{ name: string; count: number; description?: string }>;
  locations: LocationInfo[];
  locationsByType: Map<string, LocationTypeInfo>;
  recordsByLocation: Map<string, Map<string, number>>;
}

const documentCache = new Map<string, ParsedDocument>();

/**
 * Get the current dictionary
 */
function getDictionary() {
  return dictionary;
}

/**
 * Update status bar with current column heading
 */
function updateColumnStatusBar(editor: vscode.TextEditor) {
  const document = editor.document;
  const position = editor.selection.active;
  const line = document.lineAt(position.line).text;

  // Only show for DATA, UNIT, TYPE rows
  if (!line.match(/^"(DATA|UNIT|TYPE)"/i)) {
    columnStatusBarItem.hide();
    return;
  }

  const columnIndex = getColumnAtPosition(line, position.character);

  if (columnIndex === 0) {
    columnStatusBarItem.text = "$(list-ordered) Row type";
    columnStatusBarItem.show();
    return;
  }

  const parsed = parseDocument(document);
  const group = findGroupForLine(parsed, position.line);

  if (group && group.headings.length >= columnIndex) {
    const headingName = group.headings[columnIndex - 1];
    columnStatusBarItem.text = `$(list-ordered) Col ${columnIndex}: ${headingName}`;
    columnStatusBarItem.show();
  } else {
    columnStatusBarItem.text = `$(list-ordered) Col ${columnIndex}`;
    columnStatusBarItem.show();
  }
}

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext) {
  // Store extension path for loading dictionaries
  extensionPath = context.extensionPath;

  // Load dictionary (always use 4.1.1 for now)
  dictionary = loadDictionary("4.1.1", extensionPath);

  // Create status bar item for column heading
  columnStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  columnStatusBarItem.tooltip = "Current column heading (AGS)";
  context.subscriptions.push(columnStatusBarItem);

  // Create "Powered by Diggy" status bar item
  diggyStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0
  );
  diggyStatusBarItem.text = "$(tools) Powered by Diggy";
  diggyStatusBarItem.tooltip = "More AGS tools at diggy.tools";
  diggyStatusBarItem.command = "ags.openDiggy";
  context.subscriptions.push(diggyStatusBarItem);

  // Update status bar on cursor move
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document.languageId === "ags") {
        updateColumnStatusBar(event.textEditor);
        diggyStatusBarItem.show();
      } else {
        columnStatusBarItem.hide();
        diggyStatusBarItem.hide();
      }
    })
  );

  // Update status bar on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === "ags") {
        updateColumnStatusBar(editor);
        diggyStatusBarItem.show();
      } else {
        columnStatusBarItem.hide();
        diggyStatusBarItem.hide();
      }
    })
  );

  // Register hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("ags", new AGSHoverProvider())
  );

  // Register document symbol provider (outline)
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      "ags",
      new AGSDocumentSymbolProvider()
    )
  );

  // Register definition provider (go to group from reference)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider("ags", new AGSDefinitionProvider())
  );

  // Register folding range provider
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      "ags",
      new AGSFoldingRangeProvider()
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ags.showSummary", showFileSummary)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ags.goToGroup", goToGroup)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ags.openDiggy", openDiggyTools)
  );

  // Create table view provider
  tableViewProvider = new AGSTableViewProvider(parseDocument, findGroupForLine, getDictionary);
  context.subscriptions.push({
    dispose: () => tableViewProvider.dispose(),
  });

  // Register toggle table view command
  context.subscriptions.push(
    vscode.commands.registerCommand("ags.toggleTableView", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "ags") {
        tableViewProvider.toggle(editor.document);
      } else {
        vscode.window.showWarningMessage("No AGS file is currently open");
      }
    })
  );

  // Sync table view with editor selection
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document.languageId === "ags") {
        tableViewProvider.syncWithEditor(event.textEditor);
      }
    })
  );

  // Parse documents on change for caching and update table view
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "ags") {
        parseDocument(event.document);
        tableViewProvider.updateForDocumentChange();
      }
    })
  );
}

/**
 * Parse an AGS document into structured data
 */
function parseDocument(document: vscode.TextDocument): ParsedDocument {
  const groups = new Map<string, ParsedGroup>();
  let currentGroup: ParsedGroup | null = null;
  let version: string | undefined;

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Parse GROUP line
    const groupMatch = trimmed.match(/^"GROUP"\s*,\s*"([A-Z0-9_]+)"/i);
    if (groupMatch) {
      currentGroup = {
        name: groupMatch[1],
        line: i,
        headings: [],
        headingLine: -1,
        dataCount: 0,
        units: [],
        types: [],
        data: [],
      };
      groups.set(groupMatch[1], currentGroup);
      continue;
    }

    // Parse HEADING line
    const headingMatch = trimmed.match(/^"HEADING"/i);
    if (headingMatch && currentGroup) {
      currentGroup.headingLine = i;
      const headings = extractQuotedFields(trimmed);
      currentGroup.headings = headings.slice(1);
      continue;
    }

    // Parse UNIT line
    const unitMatch = trimmed.match(/^"UNIT"/i);
    if (unitMatch && currentGroup) {
      const units = extractQuotedFields(trimmed);
      currentGroup.units = units.slice(1);
      continue;
    }

    // Parse TYPE line
    const typeMatch = trimmed.match(/^"TYPE"/i);
    if (typeMatch && currentGroup) {
      const types = extractQuotedFields(trimmed);
      currentGroup.types = types.slice(1);
      continue;
    }

    // Parse DATA rows
    const dataMatch = trimmed.match(/^"DATA"/i);
    if (dataMatch && currentGroup) {
      const dataFields = extractQuotedFields(trimmed);
      currentGroup.data.push(dataFields.slice(1));
      currentGroup.dataCount++;
    }

    // Extract version from TRAN group
    if (currentGroup?.name === "TRAN" && trimmed.match(/^"DATA"/i)) {
      const fields = extractQuotedFields(trimmed);
      const agsIndex = currentGroup.headings.indexOf("TRAN_AGS");
      if (agsIndex >= 0 && fields[agsIndex + 1]) {
        version = fields[agsIndex + 1];
      }
    }
  }

  const parsed = { groups, version };
  documentCache.set(document.uri.toString(), parsed);
  return parsed;
}

/**
 * Generate comprehensive summary from parsed document
 */
function generateSummary(parsed: ParsedDocument): AGSSummary {
  const dict = getDictionary();
  const groupCounts: AGSSummary["groupCounts"] = [];
  const locations: LocationInfo[] = [];
  const locationsByType = new Map<string, LocationTypeInfo>();
  const recordsByLocation = new Map<string, Map<string, number>>();
  let totalRecords = 0;

  // Count records in each group and by location
  for (const [groupName, group] of parsed.groups) {
    groupCounts.push({
      name: groupName,
      count: group.dataCount,
      description: dict.groups[groupName],
    });
    totalRecords += group.dataCount;

    // Find LOCA_ID column to count records per location
    const locaIdIndex = group.headings.indexOf("LOCA_ID");
    if (locaIdIndex >= 0) {
      for (const row of group.data) {
        const locaId = row[locaIdIndex];
        if (locaId) {
          let locationGroups = recordsByLocation.get(locaId);
          if (!locationGroups) {
            locationGroups = new Map<string, number>();
            recordsByLocation.set(locaId, locationGroups);
          }
          locationGroups.set(groupName, (locationGroups.get(groupName) || 0) + 1);
        }
      }
    }
  }

  // Sort by count descending
  groupCounts.sort((a, b) => b.count - a.count);

  // Extract depth ranges from GEOL group
  const depthRangesByLocation = new Map<string, { min: number; max: number }>();
  const geolGroup = parsed.groups.get("GEOL");
  if (geolGroup) {
    const locaIdIndex = geolGroup.headings.indexOf("LOCA_ID");
    const topIndex = geolGroup.headings.indexOf("GEOL_TOP");
    const baseIndex = geolGroup.headings.indexOf("GEOL_BASE");

    if (locaIdIndex >= 0 && (topIndex >= 0 || baseIndex >= 0)) {
      for (const row of geolGroup.data) {
        const locaId = row[locaIdIndex];
        const top = topIndex >= 0 ? parseFloat(row[topIndex]) : NaN;
        const base = baseIndex >= 0 ? parseFloat(row[baseIndex]) : NaN;

        if (locaId) {
          const existing = depthRangesByLocation.get(locaId);
          let min = existing?.min ?? Infinity;
          let max = existing?.max ?? -Infinity;

          if (!isNaN(top)) {
            min = Math.min(min, top);
            max = Math.max(max, top);
          }
          if (!isNaN(base)) {
            min = Math.min(min, base);
            max = Math.max(max, base);
          }

          if (min !== Infinity || max !== -Infinity) {
            depthRangesByLocation.set(locaId, {
              min: min === Infinity ? 0 : min,
              max: max === -Infinity ? 0 : max,
            });
          }
        }
      }
    }
  }

  // Extract location information from LOCA group
  const locaGroup = parsed.groups.get("LOCA");
  if (locaGroup) {
    const idIndex = locaGroup.headings.indexOf("LOCA_ID");
    const eastingIndex = locaGroup.headings.indexOf("LOCA_NATE");
    const northingIndex = locaGroup.headings.indexOf("LOCA_NATN");
    const typeIndex = locaGroup.headings.indexOf("LOCA_TYPE");
    const finalDepthIndex = locaGroup.headings.indexOf("LOCA_FDEP");

    for (const row of locaGroup.data) {
      const id = idIndex >= 0 ? row[idIndex] : "";
      const easting = eastingIndex >= 0 ? row[eastingIndex] : undefined;
      const northing = northingIndex >= 0 ? row[northingIndex] : undefined;
      const type = typeIndex >= 0 ? row[typeIndex] : undefined;
      const finalDepth = finalDepthIndex >= 0 ? row[finalDepthIndex] : undefined;
      const depthRange = depthRangesByLocation.get(id);

      if (id) {
        locations.push({
          id,
          easting,
          northing,
          type,
          finalDepth,
          depthMin: depthRange?.min,
          depthMax: depthRange?.max,
        });

        // Aggregate by type
        if (type) {
          const existing = locationsByType.get(type);
          if (existing) {
            existing.count++;
            if (depthRange) {
              if (depthRange.min !== undefined) {
                existing.depthMin = existing.depthMin !== undefined
                  ? Math.min(existing.depthMin, depthRange.min)
                  : depthRange.min;
              }
              if (depthRange.max !== undefined) {
                existing.depthMax = existing.depthMax !== undefined
                  ? Math.max(existing.depthMax, depthRange.max)
                  : depthRange.max;
              }
            }
          } else {
            locationsByType.set(type, {
              count: 1,
              depthMin: depthRange?.min,
              depthMax: depthRange?.max,
            });
          }
        }
      }
    }
  }

  return {
    totalGroups: parsed.groups.size,
    totalRecords,
    groupCounts,
    locations,
    locationsByType,
    recordsByLocation,
  };
}

/**
 * Extract quoted fields from a line
 */
function extractQuotedFields(line: string): string[] {
  const fields: string[] = [];
  const regex = /"([^"]*?)"/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    fields.push(match[1]);
  }
  return fields;
}

/**
 * Get the column index at a given position in a line
 */
function getColumnAtPosition(line: string, charPosition: number): number {
  let column = 0;
  let inQuotes = false;

  for (let i = 0; i < charPosition && i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      column++;
    }
  }

  return column;
}

/**
 * Find the group that contains a given line number
 */
function findGroupForLine(
  parsed: ParsedDocument,
  lineNumber: number
): ParsedGroup | null {
  let currentGroup: ParsedGroup | null = null;

  for (const [, group] of parsed.groups) {
    if (group.line <= lineNumber) {
      if (!currentGroup || group.line > currentGroup.line) {
        currentGroup = group;
      }
    }
  }

  return currentGroup;
}

/**
 * Hover provider - shows descriptions for groups and headings
 */
class AGSHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
    const config = vscode.workspace.getConfiguration("ags");
    if (!config.get("hover.showDescriptions", true)) {
      return null;
    }

    const dict = getDictionary();
    const line = document.lineAt(position.line).text;
    const parsed = parseDocument(document);

    // Check if we're on a DATA, UNIT, or TYPE row - show column heading
    if (line.match(/^"(DATA|UNIT|TYPE)"/i)) {
      const columnIndex = getColumnAtPosition(line, position.character);

      if (columnIndex > 0) {
        const group = findGroupForLine(parsed, position.line);

        if (group && group.headings.length >= columnIndex) {
          const headingName = group.headings[columnIndex - 1];
          const headingDetail = dict.headingDetails[headingName];
          const description = dict.headings[headingName] || "";

          const markdown = new vscode.MarkdownString();

          // Line 1: field name - description
          markdown.appendMarkdown(`\`${headingName}\` - ${description}\n\n`);

          // Line 2: Unit and Type metadata
          const metaParts: string[] = [];
          if (headingDetail?.unit) {
            metaParts.push(`Unit: ${headingDetail.unit}`);
          }
          if (headingDetail?.type) {
            metaParts.push(`Type: ${headingDetail.type}`);
          }
          if (metaParts.length > 0) {
            markdown.appendMarkdown(`${metaParts.join("  |  ")}\n\n`);
          }

          // Line 3: Example value if available
          if (headingDetail?.example) {
            markdown.appendMarkdown(`Example: ${headingDetail.example}`);
          }

          return new vscode.Hover(markdown);
        }
      }
    }

    const wordRange = document.getWordRangeAtPosition(position, /[A-Z0-9_]+/i);

    if (!wordRange) return null;

    const word = document.getText(wordRange).toUpperCase();

    // Check if it's a group name
    if (dict.groups[word]) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**${word}**\n\n`);
      markdown.appendMarkdown(`${dict.groups[word]}\n\n`);
      markdown.appendMarkdown(
        `[View on Diggy](https://diggy.tools/reference/ags-groups#${word.toLowerCase()})`
      );
      return new vscode.Hover(markdown, wordRange);
    }

    // Check if it's a heading name
    if (dict.headings[word]) {
      const headingDetail = dict.headingDetails[word];
      const description = dict.headings[word] || "";

      const markdown = new vscode.MarkdownString();

      // Line 1: field name - description
      markdown.appendMarkdown(`\`${word}\` - ${description}\n\n`);

      // Line 2: Unit and Type metadata
      const metaParts: string[] = [];
      if (headingDetail?.unit) {
        metaParts.push(`Unit: ${headingDetail.unit}`);
      }
      if (headingDetail?.type) {
        metaParts.push(`Type: ${headingDetail.type}`);
      }
      if (metaParts.length > 0) {
        markdown.appendMarkdown(`${metaParts.join("  |  ")}\n\n`);
      }

      // Line 3: Example value if available
      if (headingDetail?.example) {
        markdown.appendMarkdown(`Example: ${headingDetail.example}`);
      }

      return new vscode.Hover(markdown, wordRange);
    }

    // Check if it's a type
    if (typeDescriptions[word]) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**Type: ${word}**\n\n`);
      markdown.appendMarkdown(`${typeDescriptions[word]}`);
      return new vscode.Hover(markdown, wordRange);
    }

    // Check for row types
    const rowTypes: Record<string, string> = {
      GROUP: "Defines a new data group",
      HEADING: "Column headings for the group",
      UNIT: "Units for each column",
      TYPE: "Data type for each column",
      DATA: "Data row",
    };

    if (rowTypes[word]) {
      return new vscode.Hover(
        new vscode.MarkdownString(`**${word}**: ${rowTypes[word]}`),
        wordRange
      );
    }

    return null;
  }
}

/**
 * Document symbol provider - creates outline view
 */
class AGSDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument
  ): vscode.DocumentSymbol[] {
    const parsed = parseDocument(document);
    const dict = getDictionary();
    const symbols: vscode.DocumentSymbol[] = [];

    for (const [name, group] of parsed.groups) {
      const range = new vscode.Range(group.line, 0, group.line, 100);
      const description = dict.groups[name] || "User-defined group";

      const symbol = new vscode.DocumentSymbol(
        name,
        `${description} (${group.dataCount} rows)`,
        vscode.SymbolKind.Class,
        range,
        range
      );

      // Add headings as children
      for (const heading of group.headings) {
        const headingDesc = dict.headings[heading] || dict.headingDetails[heading]?.description || "";
        const headingSymbol = new vscode.DocumentSymbol(
          heading,
          headingDesc,
          vscode.SymbolKind.Field,
          new vscode.Range(group.headingLine, 0, group.headingLine, 100),
          new vscode.Range(group.headingLine, 0, group.headingLine, 100)
        );
        symbol.children.push(headingSymbol);
      }

      symbols.push(symbol);
    }

    return symbols;
  }
}

/**
 * Definition provider - go to group definition from LOCA_ID etc
 */
class AGSDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location | null {
    const parsed = parseDocument(document);
    const wordRange = document.getWordRangeAtPosition(position, /[A-Z0-9_]+/i);

    if (!wordRange) return null;

    const word = document.getText(wordRange).toUpperCase();

    // If clicking on a group name, go to that group
    if (parsed.groups.has(word)) {
      const group = parsed.groups.get(word)!;
      return new vscode.Location(
        document.uri,
        new vscode.Position(group.line, 0)
      );
    }

    return null;
  }
}

/**
 * Folding range provider - fold each group
 */
class AGSFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const parsed = parseDocument(document);

    const groupLines = Array.from(parsed.groups.values())
      .map((g) => g.line)
      .sort((a, b) => a - b);

    for (let i = 0; i < groupLines.length; i++) {
      const startLine = groupLines[i];
      const endLine =
        i < groupLines.length - 1
          ? groupLines[i + 1] - 1
          : document.lineCount - 1;

      // Find the actual last non-empty line
      let actualEnd = endLine;
      while (actualEnd > startLine && !document.lineAt(actualEnd).text.trim()) {
        actualEnd--;
      }

      if (actualEnd > startLine) {
        ranges.push(new vscode.FoldingRange(startLine, actualEnd));
      }
    }

    return ranges;
  }
}

/**
 * Format depth range for display
 */
function formatDepthRange(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return "-";
  if (min === undefined) return `- ${max?.toFixed(2)}`;
  if (max === undefined) return `${min.toFixed(2)} -`;
  return `${min.toFixed(2)} - ${max.toFixed(2)}`;
}

/**
 * Command: Show file summary
 */
async function showFileSummary() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "ags") {
    vscode.window.showWarningMessage("No AGS file is currently open");
    return;
  }

  const parsed = parseDocument(editor.document);
  const summary = generateSummary(parsed);
  const fileName = editor.document.fileName.split(/[\\/]/).pop() || "AGS File";

  const lines: string[] = [];

  // Header
  lines.push(`# AGS File Summary`);
  lines.push(``);
  lines.push(`**File:** ${fileName}`);
  lines.push(`**Version:** ${parsed.version || "Unknown"}`);
  lines.push(`**Generated:** ${new Date().toLocaleString()}`);
  lines.push(``);

  // Overview stats
  lines.push(`## Overview`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Groups | ${summary.totalGroups} |`);
  lines.push(`| Total Records | ${summary.totalRecords.toLocaleString()} |`);
  lines.push(`| Locations | ${summary.locations.length} |`);
  lines.push(`| Location Types | ${summary.locationsByType.size} |`);
  lines.push(``);

  // Group Summary
  lines.push(`## Group Summary`);
  lines.push(``);
  lines.push(`| Group | Description | Records |`);
  lines.push(`|-------|-------------|---------|`);
  for (const { name, count, description } of summary.groupCounts) {
    const desc = description || "User-defined";
    lines.push(`| ${name} | ${desc} | ${count.toLocaleString()} |`);
  }
  lines.push(``);

  // Location Type Summary (if any)
  if (summary.locationsByType.size > 0) {
    lines.push(`## Location Type Summary`);
    lines.push(``);
    lines.push(`| Type | Count | Depth Range (m) |`);
    lines.push(`|------|-------|-----------------|`);
    const sortedTypes = Array.from(summary.locationsByType.entries())
      .sort((a, b) => b[1].count - a[1].count);
    for (const [type, data] of sortedTypes) {
      lines.push(`| ${type} | ${data.count} | ${formatDepthRange(data.depthMin, data.depthMax)} |`);
    }
    lines.push(``);
  }

  // Location Summary (if any)
  if (summary.locations.length > 0) {
    lines.push(`## Location Summary`);
    lines.push(``);
    const hasTypes = summary.locationsByType.size > 0;
    if (hasTypes) {
      lines.push(`| Location ID | Type | Depth Range (m) |`);
      lines.push(`|-------------|------|-----------------|`);
    } else {
      lines.push(`| Location ID | Depth Range (m) |`);
      lines.push(`|-------------|-----------------|`);
    }
    for (const loc of summary.locations) {
      if (hasTypes) {
        lines.push(`| ${loc.id} | ${loc.type || "-"} | ${formatDepthRange(loc.depthMin, loc.depthMax)} |`);
      } else {
        lines.push(`| ${loc.id} | ${formatDepthRange(loc.depthMin, loc.depthMax)} |`);
      }
    }
    lines.push(``);
  }

  // Records by Location (if locations exist and not too many)
  if (summary.recordsByLocation.size > 0 && summary.recordsByLocation.size <= 20) {
    lines.push(`## Records by Location`);
    lines.push(``);

    // Get all location IDs sorted
    const locationIds = Array.from(summary.recordsByLocation.keys()).sort();

    // Get groups that have location-based records
    const groupsWithLocationData = summary.groupCounts.filter(({ name }) => {
      for (const groupCounts of summary.recordsByLocation.values()) {
        if (groupCounts.has(name)) return true;
      }
      return false;
    });

    if (groupsWithLocationData.length > 0) {
      // Header row
      let headerRow = `| Group |`;
      let separatorRow = `|-------|`;
      for (const locId of locationIds) {
        headerRow += ` ${locId} |`;
        separatorRow += `------|`;
      }
      lines.push(headerRow);
      lines.push(separatorRow);

      // Data rows
      for (const { name } of groupsWithLocationData) {
        let dataRow = `| ${name} |`;
        for (const locId of locationIds) {
          const count = summary.recordsByLocation.get(locId)?.get(name);
          dataRow += ` ${count || "-"} |`;
        }
        lines.push(dataRow);
      }
      lines.push(``);
    }
  } else if (summary.recordsByLocation.size > 20) {
    lines.push(`## Records by Location`);
    lines.push(``);
    lines.push(`*${summary.recordsByLocation.size} locations - table omitted for readability*`);
    lines.push(``);
  }

  // Footer
  lines.push(`---`);
  lines.push(`*Generated by [Diggy AGS for VS Code](https://diggy.tools/tools/ags-vscode-extension)*`);

  // Show in a new document
  const doc = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/**
 * Command: Go to group
 */
async function goToGroup() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "ags") {
    vscode.window.showWarningMessage("No AGS file is currently open");
    return;
  }

  const parsed = parseDocument(editor.document);
  const dict = getDictionary();

  const items = Array.from(parsed.groups.entries()).map(([name, group]) => ({
    label: `$(symbol-class) ${name}`,
    description: `$(symbol-field) ${group.headings.length} headings  $(list-ordered) ${group.dataCount} rows`,
    detail: dict.groups[name] || "User-defined group",
    line: group.line,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a group to navigate to",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected) {
    const position = new vscode.Position(selected.line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );
  }
}

/**
 * Command: Open Diggy tools website
 */
function openDiggyTools() {
  vscode.env.openExternal(vscode.Uri.parse("https://diggy.tools/tools"));
}

/**
 * Deactivate the extension
 */
export function deactivate() {
  documentCache.clear();
}
