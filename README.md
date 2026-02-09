# Diggy AGS for VS Code

Language support for AGS (Association of Geotechnical and Geoenvironmental Specialists) data files.

Built by [Diggy](https://diggy.tools).

## Features

### Syntax Highlighting
Clean, readable color scheme with each row type clearly distinguished:

- **GROUP rows**: Purple - section headers stand out for navigation
- **HEADING rows**: Light blue - column names easy to reference
- **UNIT rows**: Orange - units visible but not distracting
- **TYPE rows**: Green - data types clearly marked
- **DATA rows**: White - clean and easy to read

Works with both dark and light VS Code themes.

### Column Identification
Stop counting columns! The extension helps you identify which heading each value belongs to:

- **Hover tooltips**: Hover over any cell in DATA, UNIT, or TYPE rows to see the column heading name, type, and unit
- **Status bar**: Shows the current column heading as you move your cursor through the file
- **Quick reference**: No more counting commas to find which field you're looking at

### IntelliSense
Powered by the complete official AGS data dictionary:

- **Group descriptions**: Hover over any of the 140+ standard group names to see descriptions
- **Heading descriptions**: Full descriptions for 1000+ headings with type and unit info
- **Outline view**: See all groups in the file at a glance in the Explorer sidebar
- **Go to Group**: Quick navigation to any group (Ctrl+Shift+O)

### Code Folding
- Collapse/expand individual groups
- Great for navigating large AGS files with many groups

### Table View
No more squinting at misaligned columns! Open an aligned, editable table view with **Ctrl+Shift+T**:

- **Aligned columns**: See your data in a proper table format
- **Group selector**: Switch between groups with a dropdown showing descriptions
- **Column tooltips**: Hover over headers to see heading descriptions
- **Color-coded rows**: HEADING (blue), UNIT (orange), TYPE (yellow) matching the editor
- **Two-way sync**: Click a row to jump to it in the editor, move cursor to highlight in table
- **Inline editing**: Double-click any cell to edit, use arrow keys to navigate
- **Live updates**: Changes sync back to the source file instantly

### File Summary
Generate a comprehensive summary report of your AGS file with:

- **Overview statistics**: Total groups, records, locations, and location types
- **Group Summary**: All groups with descriptions and record counts
- **Location Type Summary**: Breakdown by location type (BH, CP, TP, etc.) with depth ranges
- **Location Summary**: Individual locations with types and depth ranges
- **Records by Location**: Matrix showing which groups have data for each location

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `AGS: Toggle Table View` | Ctrl+Shift+T | Open/close the aligned table view |
| `AGS: Show File Summary` | | Generate comprehensive summary with tables |
| `AGS: Go to Group` | | Quick picker to navigate to any group |
| `AGS: More Tools on Diggy` | | Open diggy.tools for more AGS tools |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ags.hover.showDescriptions` | `true` | Show descriptions on hover |

## Supported AGS Versions

- AGS 4.0.3
- AGS 4.0.4
- AGS 4.1
- AGS 4.1.1

## More AGS Tools

Need more AGS functionality? Check out [diggy.tools](https://diggy.tools) for:

- AGS File Summary & Statistics
- AGS Data Reducer
- And more free geotechnical tools

## Contributing

Found a bug or have a feature request? [Open an issue](https://github.com/sotech-studio/diggy-vscode-ags/issues).

## License

MIT
