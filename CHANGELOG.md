# Changelog

All notable changes to the "Diggy AGS" extension will be documented in this file.

## [1.1.0] - 2026-02-17

### Improved
- **Distinct row colors**: Each row type now has its own color — GROUP (blue), HEADING (green), UNIT (orange), TYPE (pink), DATA (white keyword / orange values)
- **Grey commas**: Comma separators are now a subtle grey across all row types
- **Hover tooltips**: Cleaner format showing field name, description, unit/type metadata, and example values
- Light theme colors updated to match the new scheme

## [1.0.0] - 2026-01-11

### Features
- **Syntax highlighting** with distinct colors for each row type (GROUP, HEADING, UNIT, TYPE, DATA)
- **Column identification**: Hover over any cell to see the column heading name, type, and unit
- **Status bar**: Shows current column heading as you navigate
- **Complete AGS data dictionary**: 140+ groups and 1000+ headings with descriptions
- **Outline view**: See all groups in the Explorer sidebar
- **Code folding**: Collapse/expand individual groups
- **Table View**: Aligned, editable table view for AGS data (Ctrl+Shift+T):
  - View data in a properly aligned table format
  - Group selector dropdown with descriptions
  - Column header tooltips showing heading descriptions
  - Color-coded rows matching syntax highlighting (blue/orange/yellow)
  - Two-way sync with editor (click row to navigate, cursor updates table)
  - Inline cell editing with arrow key navigation
  - Changes sync back to the source file
- **File Summary**: Generate comprehensive markdown summary with:
  - Overview statistics (groups, records, locations, location types)
  - Group Summary table with descriptions and record counts
  - Location Type Summary with depth ranges
  - Location Summary with individual locations
  - Records by Location matrix
- **Go to Group**: Quick navigation to any group
- **Powered by Diggy**: Status bar link to more AGS tools at diggy.tools
- Support for AGS 4.0.3, 4.0.4, 4.1, and 4.1.1
