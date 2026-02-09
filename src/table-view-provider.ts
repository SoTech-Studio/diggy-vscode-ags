import * as vscode from "vscode";

// Import types from extension - these will be exported
export interface ParsedGroup {
  name: string;
  line: number;
  headings: string[];
  headingLine: number;
  dataCount: number;
  units: string[];
  types: string[];
  data: string[][];
  unitLine?: number;
  typeLine?: number;
}

export interface ParsedDocument {
  groups: Map<string, ParsedGroup>;
  version?: string;
}

interface CellEditMessage {
  type: "cellEdit";
  rowType: "UNIT" | "TYPE" | "DATA";
  rowIndex: number;
  colIndex: number;
  oldValue: string;
  newValue: string;
}

interface NavigateMessage {
  type: "navigate";
  rowType: "HEADING" | "UNIT" | "TYPE" | "DATA";
  rowIndex: number;
}

interface SelectGroupMessage {
  type: "selectGroup";
  groupName: string;
}

type WebviewMessage = CellEditMessage | NavigateMessage | SelectGroupMessage;

interface Dictionary {
  groups: Record<string, string>;
  headings: Record<string, string>;
  headingDetails: Record<string, { description?: string; type?: string; unit?: string; status?: string }>;
}

export class AGSTableViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private currentDocument: vscode.TextDocument | undefined;
  private currentGroup: string | undefined;
  private parseDocument: (doc: vscode.TextDocument) => ParsedDocument;
  private findGroupForLine: (
    parsed: ParsedDocument,
    line: number
  ) => ParsedGroup | null;
  private getDictionary: () => Dictionary;
  private disposables: vscode.Disposable[] = [];

  constructor(
    parseDocument: (doc: vscode.TextDocument) => ParsedDocument,
    findGroupForLine: (
      parsed: ParsedDocument,
      line: number
    ) => ParsedGroup | null,
    getDictionary: () => Dictionary
  ) {
    this.parseDocument = parseDocument;
    this.findGroupForLine = findGroupForLine;
    this.getDictionary = getDictionary;
  }

  public async toggle(document: vscode.TextDocument): Promise<void> {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    } else {
      await this.show(document);
    }
  }

  public async show(document: vscode.TextDocument): Promise<void> {
    this.currentDocument = document;

    if (this.panel) {
      this.panel.reveal();
      this.updateContent();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "agsTableView",
      "AGS Table View",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    // Move the panel to below the current editor
    await vscode.commands.executeCommand("workbench.action.moveEditorToBelowGroup");

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this.disposables
    );

    // Set initial group from cursor position
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === document) {
      const parsed = this.parseDocument(document);
      const group = this.findGroupForLine(parsed, editor.selection.active.line);
      if (group) {
        this.currentGroup = group.name;
      } else {
        // Default to first group
        const firstGroup = parsed.groups.keys().next().value;
        this.currentGroup = firstGroup;
      }
    }

    this.updateContent();
  }

  public hide(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  public syncWithEditor(editor: vscode.TextEditor): void {
    if (!this.panel || !this.currentDocument) return;
    if (editor.document !== this.currentDocument) return;

    const parsed = this.parseDocument(this.currentDocument);
    const group = this.findGroupForLine(parsed, editor.selection.active.line);

    if (group) {
      const needsGroupSwitch = this.currentGroup !== group.name;

      if (needsGroupSwitch) {
        this.currentGroup = group.name;
        this.updateContent();
      }

      // Calculate row index for highlighting
      const lineNumber = editor.selection.active.line;
      const lineText = editor.document.lineAt(lineNumber).text;

      let rowType: string | undefined;
      let rowIndex = -1;

      if (lineText.match(/^"HEADING"/i)) {
        rowType = "HEADING";
        rowIndex = 0;
      } else if (lineText.match(/^"UNIT"/i)) {
        rowType = "UNIT";
        rowIndex = 0;
      } else if (lineText.match(/^"TYPE"/i)) {
        rowType = "TYPE";
        rowIndex = 0;
      } else if (lineText.match(/^"DATA"/i)) {
        rowType = "DATA";
        // Calculate which DATA row (0-based index)
        // Find the line of the first DATA row
        const firstDataLine = this.findFirstDataLine(group);
        if (firstDataLine >= 0) {
          rowIndex = lineNumber - firstDataLine;
        }
      }

      if (rowType && rowIndex >= 0) {
        this.panel.webview.postMessage({
          type: "highlight",
          rowType,
          rowIndex,
        });
      }
    }
  }

  public updateForDocumentChange(): void {
    if (this.panel && this.currentDocument) {
      this.updateContent();
    }
  }

  private findFirstDataLine(group: ParsedGroup): number {
    // The first DATA line is after GROUP, HEADING, UNIT, TYPE
    // But we need to find it by scanning from group.line
    if (!this.currentDocument) return -1;

    for (
      let i = group.line;
      i < this.currentDocument.lineCount && i < group.line + 10;
      i++
    ) {
      const line = this.currentDocument.lineAt(i).text;
      if (line.match(/^"DATA"/i)) {
        return i;
      }
    }
    return -1;
  }

  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case "cellEdit":
        this.handleCellEdit(message);
        break;
      case "navigate":
        this.handleNavigate(message);
        break;
      case "selectGroup":
        this.handleSelectGroup(message);
        break;
    }
  }

  private async handleCellEdit(message: CellEditMessage): Promise<void> {
    if (!this.currentDocument || !this.currentGroup) return;

    const parsed = this.parseDocument(this.currentDocument);
    const group = parsed.groups.get(this.currentGroup);
    if (!group) return;

    // Find the line number for this cell
    const lineNumber = this.getLineNumber(group, message.rowType, message.rowIndex);
    if (lineNumber < 0) return;

    const line = this.currentDocument.lineAt(lineNumber).text;

    // Find the character range for this column
    const range = this.getCellRange(line, lineNumber, message.colIndex);
    if (!range) return;

    // Apply the edit
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.currentDocument.uri, range, message.newValue);
    await vscode.workspace.applyEdit(edit);
  }

  private getLineNumber(
    group: ParsedGroup,
    rowType: "UNIT" | "TYPE" | "DATA",
    rowIndex: number
  ): number {
    if (!this.currentDocument) return -1;

    // Scan from group line to find the specific row
    let unitLine = -1;
    let typeLine = -1;
    let dataLines: number[] = [];

    for (
      let i = group.line;
      i < this.currentDocument.lineCount && i < group.line + group.dataCount + 10;
      i++
    ) {
      const line = this.currentDocument.lineAt(i).text;
      if (line.match(/^"UNIT"/i) && unitLine < 0) {
        unitLine = i;
      } else if (line.match(/^"TYPE"/i) && typeLine < 0) {
        typeLine = i;
      } else if (line.match(/^"DATA"/i)) {
        dataLines.push(i);
      } else if (line.match(/^"GROUP"/i) && i > group.line) {
        // Hit next group, stop
        break;
      }
    }

    switch (rowType) {
      case "UNIT":
        return unitLine;
      case "TYPE":
        return typeLine;
      case "DATA":
        return dataLines[rowIndex] ?? -1;
    }
  }

  private getCellRange(
    line: string,
    lineNumber: number,
    colIndex: number
  ): vscode.Range | null {
    // colIndex is 0-based for data columns (excluding row type)
    // We need to find the (colIndex + 1)th quoted field (since col 0 is row type)
    const targetFieldIndex = colIndex + 1;

    let fieldIndex = 0;
    let i = 0;

    while (i < line.length && fieldIndex <= targetFieldIndex) {
      if (line[i] === '"') {
        const startQuote = i;
        i++; // Move past opening quote
        const contentStart = i;

        // Find closing quote
        while (i < line.length && line[i] !== '"') {
          i++;
        }

        const contentEnd = i;

        if (fieldIndex === targetFieldIndex) {
          // Return the range of the content (not including quotes)
          return new vscode.Range(
            lineNumber,
            contentStart,
            lineNumber,
            contentEnd
          );
        }

        fieldIndex++;
        i++; // Move past closing quote
      } else {
        i++;
      }
    }

    return null;
  }

  private handleNavigate(message: NavigateMessage): void {
    if (!this.currentDocument || !this.currentGroup) return;

    const parsed = this.parseDocument(this.currentDocument);
    const group = parsed.groups.get(this.currentGroup);
    if (!group) return;

    let lineNumber: number;

    switch (message.rowType) {
      case "HEADING":
        lineNumber = group.headingLine;
        break;
      case "UNIT":
        lineNumber = this.getLineNumber(group, "UNIT", 0);
        break;
      case "TYPE":
        lineNumber = this.getLineNumber(group, "TYPE", 0);
        break;
      case "DATA":
        lineNumber = this.getLineNumber(group, "DATA", message.rowIndex);
        break;
      default:
        return;
    }

    if (lineNumber < 0) return;

    // Find the editor showing this document
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document === this.currentDocument
    );

    if (editor) {
      const position = new vscode.Position(lineNumber, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }

  private handleSelectGroup(message: SelectGroupMessage): void {
    this.currentGroup = message.groupName;
    this.updateContent();
  }

  private updateContent(): void {
    if (!this.panel || !this.currentDocument) return;

    const parsed = this.parseDocument(this.currentDocument);

    // Ensure we have a valid current group
    if (!this.currentGroup || !parsed.groups.has(this.currentGroup)) {
      const firstGroup = parsed.groups.keys().next().value;
      this.currentGroup = firstGroup;
    }

    if (!this.currentGroup) {
      this.panel.webview.html = this.getEmptyHtml();
      return;
    }

    const group = parsed.groups.get(this.currentGroup)!;
    this.panel.webview.html = this.getHtmlContent(parsed, group);
  }

  private getEmptyHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
  </style>
</head>
<body>
  <p>No groups found in this AGS file.</p>
</body>
</html>`;
  }

  private getHtmlContent(parsed: ParsedDocument, group: ParsedGroup): string {
    const dict = this.getDictionary();

    // Build group options (just names, description shown separately)
    const groupOptions = Array.from(parsed.groups.keys())
      .map(
        (name) =>
          `<option value="${this.escapeHtml(name)}" ${name === this.currentGroup ? "selected" : ""}>${this.escapeHtml(name)}</option>`
      )
      .join("");

    // Get current group description
    const groupDescription = dict.groups[group.name] || "User-defined group";

    // Build table content
    const tableContent = this.buildTableHtml(group, dict);

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 0;
      margin: 0;
    }

    .toolbar {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--vscode-editor-background);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .toolbar label {
      font-weight: 500;
    }

    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      padding: 4px 8px;
      border-radius: 2px;
    }

    .record-count {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }

    .group-description {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      font-style: italic;
      padding: 8px 12px 12px 12px;
      background: var(--vscode-editor-background);
      position: sticky;
      top: 0;
      z-index: 2;
    }

    .table-container {
      overflow: auto;
      height: calc(100vh - 46px);
    }

    table {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
    }

    th, td {
      padding: 4px 12px;
      border: 1px solid var(--vscode-panel-border);
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      text-align: left;
    }

    th {
      position: sticky;
      top: 33px;
      background: linear-gradient(rgba(156, 220, 254, 0.15), rgba(156, 220, 254, 0.15)), var(--vscode-editor-background);
      font-weight: 600;
      z-index: 1;
      border-bottom: 2px solid var(--vscode-panel-border);
    }

    .row-unit {
      background: rgba(253, 186, 116, 0.15);
    }

    .row-type {
      background: rgba(220, 220, 170, 0.15);
    }

    .row-data:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .row-selected {
      background: var(--vscode-list-activeSelectionBackground) !important;
      color: var(--vscode-list-activeSelectionForeground);
    }

    tr {
      cursor: pointer;
    }

    td.editable {
      cursor: text;
    }

    td.editing {
      padding: 0;
    }

    td.editing input {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 12px;
      border: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -2px;
    }

    .col-index {
      color: var(--vscode-descriptionForeground);
      font-size: 0.8em;
      margin-left: 4px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <label for="groupSelect">Group:</label>
    <select id="groupSelect">${groupOptions}</select>
    <span class="record-count">${group.dataCount} records, ${group.headings.length} columns</span>
  </div>
  <div class="table-container">
    <div class="group-description">${this.escapeHtml(groupDescription)}</div>
    <table id="dataTable">
      ${tableContent}
    </table>
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    // Handle group selection
    document.getElementById('groupSelect').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'selectGroup', groupName: e.target.value });
    });

    // Handle row clicks for navigation (single-click navigates)
    document.querySelectorAll('tr[data-row-type]').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't navigate if currently editing
        if (e.target.classList.contains('editing') || e.target.tagName === 'INPUT') {
          return;
        }
        vscode.postMessage({
          type: 'navigate',
          rowType: row.dataset.rowType,
          rowIndex: parseInt(row.dataset.rowIndex) || 0
        });
      });
    });

    // Handle cell double-click for editing
    document.querySelectorAll('td.editable').forEach(cell => {
      cell.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startEditing(cell);
      });
    });

    function startEditing(cell) {
      if (cell.classList.contains('editing')) return;

      const value = cell.textContent || '';
      const row = cell.parentElement;
      cell.classList.add('editing');
      cell.innerHTML = '<input type="text" value="' + escapeHtml(value) + '">';
      const input = cell.querySelector('input');
      input.select();
      input.focus();

      const handleKeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit(cell, input.value, value, row);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit(cell, value);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commitEdit(cell, input.value, value, row);
          // Move to next/prev cell
          const cells = Array.from(row.querySelectorAll('td.editable'));
          const currentIndex = cells.indexOf(cell);
          const nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
          if (nextIndex >= 0 && nextIndex < cells.length) {
            startEditing(cells[nextIndex]);
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          commitEdit(cell, input.value, value, row);
          // Move to cell above/below
          const colIndex = parseInt(cell.dataset.colIndex);
          const rows = Array.from(document.querySelectorAll('tr[data-row-type]'));
          const currentRowIndex = rows.indexOf(row);
          const targetRowIndex = e.key === 'ArrowUp' ? currentRowIndex - 1 : currentRowIndex + 1;
          if (targetRowIndex >= 0 && targetRowIndex < rows.length) {
            const targetRow = rows[targetRowIndex];
            const targetCell = targetRow.querySelector('td[data-col-index="' + colIndex + '"]');
            if (targetCell && targetCell.classList.contains('editable')) {
              startEditing(targetCell);
            }
          }
        } else if (e.key === 'ArrowLeft' && input.selectionStart === 0) {
          e.preventDefault();
          commitEdit(cell, input.value, value, row);
          // Move to cell on left
          const cells = Array.from(row.querySelectorAll('td.editable'));
          const currentIndex = cells.indexOf(cell);
          if (currentIndex > 0) {
            startEditing(cells[currentIndex - 1]);
          }
        } else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) {
          e.preventDefault();
          commitEdit(cell, input.value, value, row);
          // Move to cell on right
          const cells = Array.from(row.querySelectorAll('td.editable'));
          const currentIndex = cells.indexOf(cell);
          if (currentIndex < cells.length - 1) {
            startEditing(cells[currentIndex + 1]);
          }
        }
      };

      const handleBlur = () => {
        // Small delay to allow Tab handling to work
        setTimeout(() => {
          if (cell.classList.contains('editing')) {
            commitEdit(cell, input.value, value, row);
          }
        }, 100);
      };

      input.addEventListener('keydown', handleKeydown);
      input.addEventListener('blur', handleBlur);
    }

    function commitEdit(cell, newValue, oldValue, row) {
      cell.classList.remove('editing');
      cell.textContent = newValue;

      if (newValue !== oldValue) {
        vscode.postMessage({
          type: 'cellEdit',
          rowType: row.dataset.rowType,
          rowIndex: parseInt(row.dataset.rowIndex) || 0,
          colIndex: parseInt(cell.dataset.colIndex),
          oldValue: oldValue,
          newValue: newValue
        });
      }
    }

    function cancelEdit(cell, originalValue) {
      cell.classList.remove('editing');
      cell.textContent = originalValue;
    }

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'highlight') {
        document.querySelectorAll('.row-selected').forEach(r => r.classList.remove('row-selected'));
        const selector = 'tr[data-row-type="' + msg.rowType + '"][data-row-index="' + msg.rowIndex + '"]';
        const row = document.querySelector(selector);
        if (row) {
          row.classList.add('row-selected');
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    });

    function escapeHtml(text) {
      if (text === null || text === undefined) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
  }

  private buildTableHtml(group: ParsedGroup, dict: Dictionary): string {
    const rows: string[] = [];

    // Header row (column names with description tooltips)
    rows.push("<thead><tr>");
    for (let i = 0; i < group.headings.length; i++) {
      const heading = group.headings[i];
      const detail = dict.headingDetails[heading];
      const description = detail?.description || dict.headings[heading] || "";

      rows.push(
        `<th title="${this.escapeHtml(description)}">${this.escapeHtml(heading)}<span class="col-index">[${i + 1}]</span></th>`
      );
    }
    rows.push("</tr></thead>");

    rows.push("<tbody>");

    // UNIT row
    if (group.units.length > 0) {
      rows.push('<tr class="row-unit" data-row-type="UNIT" data-row-index="0">');
      for (let i = 0; i < group.headings.length; i++) {
        const value = group.units[i] || "";
        rows.push(
          `<td class="editable" data-col-index="${i}">${this.escapeHtml(value)}</td>`
        );
      }
      rows.push("</tr>");
    }

    // TYPE row
    if (group.types.length > 0) {
      rows.push('<tr class="row-type" data-row-type="TYPE" data-row-index="0">');
      for (let i = 0; i < group.headings.length; i++) {
        const value = group.types[i] || "";
        rows.push(
          `<td class="editable" data-col-index="${i}">${this.escapeHtml(value)}</td>`
        );
      }
      rows.push("</tr>");
    }

    // DATA rows
    for (let rowIdx = 0; rowIdx < group.data.length; rowIdx++) {
      const dataRow = group.data[rowIdx];
      rows.push(
        `<tr class="row-data" data-row-type="DATA" data-row-index="${rowIdx}">`
      );
      for (let i = 0; i < group.headings.length; i++) {
        const value = dataRow[i] || "";
        rows.push(
          `<td class="editable" data-col-index="${i}">${this.escapeHtml(value)}</td>`
        );
      }
      rows.push("</tr>");
    }

    rows.push("</tbody>");

    return rows.join("\n");
  }

  private escapeHtml(text: string): string {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  public dispose(): void {
    this.hide();
    this.disposables.forEach((d) => d.dispose());
  }
}
