PlanTint 1.7.1
Highlighting and measuring for architectural and technical drawings.

INSTALL
  PlanTint-Setup-1.7.1.exe
      Installs for your Windows user only (no admin rights needed), adds Start menu and
      desktop shortcuts, and opens .plantint project files when you double-click them.
      Recommended. Installing over an earlier version keeps your settings.

  PlanTint-1.7.1-portable.exe
      One file, nothing installed. It unpacks itself each time, so it starts a few
      seconds slower than the installed version.

  The program is not code-signed, so Windows may show "Windows protected your PC".
  Click "More info", then "Run anyway".

WHAT'S NEW IN 1.7.1
  The installer's progress bar fills once, from start to finish. Before, it filled while the
  files were unpacked, then went back and filled again for the last steps.

WHAT'S NEW IN 1.7: MERGING, AND THE MARKUPS WINDOW BESIDE THE DRAWING
  1. Merge markups into one.
     - In the markups window, drag a row onto another: the dragged markup goes into the one
       you drop it on. Drag one of several selected rows to take them all. Near the top or
       bottom of the table the rows scroll, to reach one further away.
     - Or select two or more and click Merge in the window (into the first selected in the
       table), right-click one of them on the sheet (Merge into that one), or press Ctrl+M
       (into the one selected first).
     - The one merged into keeps its name, colour, status and place in the drawing order.
     - Neighbours become one continuous area: the line or the writing between them (up to
       1.2 mm wide on the sheet) is filled in, so a building split by its number, or plots
       with a line between them, become one. Their outlines stay as they were.
     - Areas further apart stay where they are, as parts of one markup (one name, one
       total area).
     - It is one step: Ctrl+Z, or Undo in the message, brings them back as they were.
  2. The markups window beside the drawing.
     - It opens over the right part of PlanTint's window, so most of the sheet stays in
       view, and stays in front of PlanTint (a click on the drawing does not hide it).
       Drag its edges to any size; a narrow window keeps every button and the table in
       view. It opens again where you left it, at the size you gave it.
     - Show on drawing (ticked at first): a click on a row brings that markup into view
       on the sheet, beside the window rather than under it, and makes its outline flash,
       so you can tell which one it is. The sheet only moves when the markup is out of
       view, and zooms out only when it does not fit.
     - The other way round: click a markup on the sheet and the table scrolls to its row.
     - With several drawings open, each drawing's window shows only with its drawing.

WHAT'S NEW IN 1.6: THE MARKUPS WINDOW
  The button at the top right of the markup list (next to the total) opens every markup
  in a window of its own, with room to work on hundreds of them. Put it beside the
  drawing or on a second screen; it stays up to date with the drawing both ways.
  - The table: colour, name, area and perimeter (with a scale), and on the progress map
    the status, % done and units. Click a column title to sort by it (names in natural
    order: V2 before V10); # goes back to drawing order.
  - Find by name (Ctrl+F), or show one colour or one status with the chips at the top.
  - Click a row to select it on the sheet; Ctrl+click adds, Shift+click selects a range,
    Ctrl+A or "Select all" selects every row shown. Double-click a row to zoom to it.
  - Type in a name to rename. Click a swatch to recolour that markup (or all the
    selected ones it belongs to). The bar above the table recolours, sets the status of,
    zooms to or deletes everything selected.
  - Ctrl+Z and Ctrl+Y undo and redo here too; Delete deletes the selected markups; Esc
    clears the search or the selection; Ctrl+W closes the window.
  Ctrl+A on the sheet still selects every markup.

WHAT'S NEW IN 1.5.1: HIGHLIGHTS ON LAYOUTS THAT ARE ALREADY COLOURED
  A highlight now shows its own colour on a drawing that already has colour in it, such
  as a layout whose buildings are filled green, orange or yellow, or a plan with painted
  rooms. Before, the new colour mixed with the old one (red on green came out olive).
  - Under each highlight the colour already painted on the drawing is taken out, and the
    highlight's colour goes on clean paper. Lines, text and building numbers stay.
  - Only filled areas count as paint. Coloured lines, text, revision clouds, hatching and
    symbols stay as they are, so do black and dark grey (walls, line work).
  - Nothing in the drawing itself changes: move, recolour or delete the highlight and the
    old colour is back. It works on screen, when zoomed in, and in PNG, JPEG and PDF.
    In a PDF the drawing stays vector; only the painted pixels under highlights are
    replaced by pictures.
  - "Cover colour already on the drawing", at the bottom of the style card, is on for
    every highlight. Untick it for a highlight that should tint the colour under it like
    a highlighter pen instead. It is saved with the project.
  - Fill: Shift+click adds the area to the highlight next to it. On a low-resolution
    picture of a layout, a building number written right across a building can stop Fill
    at the number, so only one side fills: Shift+click the other side and the building is
    one highlight, number included.

WHAT'S NEW IN 1.5: PROGRESS MAP AND SNAG PINS
  1. Progress map.
     Turn on Progress map in the side panel and every zone shows the colour of its
     status: red Not started, amber In progress, green Done, grey Not counted. Your own
     colours come back when you turn it off.
     - Select zones, then click a status in the panel or press 1 (Not started),
       2 (In progress), 3 (Done) or 0 (Not counted). Right-click a zone for the same.
       A zone in progress gets a "% done" slider; it starts at 50%.
     - The panel shows the % complete with a bar and how many zones have each status.
       "Count by Area" weighs each zone by its visible area. "Count by Units" weighs each
       zone by a number you give it, for example 3 for a zone with three play areas.
       Zones not counted (a cancelled item, say) are left out of every total.
     - "% on sheet" writes each zone's % inside it; drag a label to move it. It prints.
     - With the legend on (L), the legend becomes the progress table: each status with
       its zones, their area or units and share, and the % complete.
     - "Progress report…" (or Save as) writes an Excel workbook: every zone with its
       status, % done and area or units, the % complete and the totals by status. The
       totals are formulas, so changing a status or a % in Excel updates them.
     - Statuses, % and units are saved with the project, and every change can be undone.

  2. Snag pins (X).
     Press X and click where a defect is: a numbered pin drops there, ready for you to
     type what is wrong (Enter to finish). A number is never given twice, even after its
     pin is deleted, so a list sent out earlier stays right.
     - The card at the top of the side panel edits the selected pin: its status (Open,
       Fixed, Closed; keys 1, 2, 3), trade (Civil, Mechanical, Electrical, Firefighting,
       Landscape, Other, or type your own), note and photo. Closing a pin dates it.
     - Photos: "Add photo…" picks a file, Ctrl+V pastes a copied picture or screenshot,
       or drag a photo from Explorer onto the card. Photos are turned upright, kept at up
       to 1600 pixels and stored inside the project file.
     - Drag a pin to move it. Double-click it to edit its note. Right-click it for its
       status, photo, zoom and delete. Pins undo, select (Ctrl+A, dragging a box) and
       move together with the other markings.
     - The Snags section lists every pin with its note, trade and the zone it is in.
       Click one to find it on the sheet; filter by status.
     - Pins print in PDFs and pictures, on top of everything else. They are as big as
       the text size set under Measurements.
     - "Snag list…" (or Save as) writes an Excel workbook: number, location (the zone the
       pin is in), trade, description, status, the dates raised and closed, and the photo
       in its row. A second sheet counts the snags by trade and status.

  Projects saved by 1.5 keep the progress map, the pins and their photos (project
  format 4). Projects from 1.0 to 1.4 open in 1.5. Opened in 1.4, a 1.5 project shows
  its markings without the statuses and pins.

WHAT'S NEW IN 1.4: TABS
  Work on several drawings at once. Each drawing is a tab in one window, like the tabs
  of a browser. Each tab is its own drawing, with its own markings, scale, measurements
  and unsaved-work question.

  - Opening a drawing (Ctrl+O, the Open button, or dropping a file on the window) puts
    it in a new tab when the tab you are in already has a drawing; an empty tab takes it
    in. Ctrl+N, or the + after the last tab, opens an empty tab.
  - Click a tab's name to show it, or press Ctrl+Tab (Ctrl+Shift+Tab goes back). A dot
    on a tab means it has unsaved work.
  - Ctrl+W, or the × on a tab, closes that tab and leaves the others open. Closing the
    window asks about each tab with unsaved work, one after the other.
  - Ctrl+N, Ctrl+W and Ctrl+Tab work wherever you are, even while typing in a box.
  - Drag the empty part of the tab strip to move the window.
  - Opening a drawing or project from Windows Explorer (double-click, or Open with) while
    PlanTint is already running opens it in a new tab of the open window.
  - Crash recovery is kept for each tab. After a crash, PlanTint offers the unsaved
    copies one at a time when it starts.
  - Every tab loads its own PDF engine, so several large drawings use more memory.

  1.4.1 fixes two things in 1.4.0: the + button did nothing, and opening a drawing
  replaced the one in the tab you were in.

  The project file format did not change in 1.4: projects from 1.0 to 1.3 open in 1.4.

WHAT'S NEW IN 1.3: SEVERAL WINDOWS (1.4 shows them as tabs)
  Work on more than one drawing at once. Each window is its own drawing, with its own
  markings, scale, measurements and unsaved-work question.

  - Ctrl+N opens an empty window. Ctrl+O (or dropping a file on the window) loads a
    drawing into the window you are in, so open each drawing in its own window to keep
    them side by side.
  - Opening a drawing or project from Windows Explorer (double-click, or Open with)
    while PlanTint is already running opens it in a new window.
  - Switch between windows with Alt+Tab or the taskbar. Each window's title shows its
    file name.
  - Closing a window asks only about its own drawing. The other windows stay open.
  - Crash recovery is kept for each window. After a crash, PlanTint offers the unsaved
    copies one at a time when it starts. A window that is still open never offers
    another window's copy.
  - Every window loads its own PDF engine, so several large drawings use more memory.

  The project file format did not change: projects from 1.0, 1.1 and 1.2 open in 1.3,
  and 1.3 projects open in 1.2.

WHAT'S NEW IN 1.2: MEASURING
  Everything below is optional; turn each part on or off under Measurements in the side
  panel. Every change there can be undone, and it is saved with the project.

  1. The scale.
     PlanTint reads the scale from the title block ("1:50"). When a print is not at its
     stated scale, or the drawing is a scan or photo, use Calibrate (C): click both ends
     of a length you know (an overall dimension, a grid spacing, a door) and type its real
     length, in any unit ("12", "12600 mm", "39'4 1/2""). The dialog shows the resulting
     scale and warns when it disagrees with the title block. You can also type a scale in
     the bar at the bottom while drawing, or press Reset to go back to the title block.
     Use the longest length you know: the result is more accurate.

  2. Units.
     Lengths in mm, cm, m, km, inches, feet, feet and inches, or yards; areas in mm², cm²,
     m², hectares, km², in², ft², yd² or acres; decimals automatic or 0 to 3 (with feet and
     inches: rounding to 1", 1/2", 1/4", 1/8" or 1/16"). Rectangle sizes are typed in the
     same unit (14'6" works too). Calibrating in feet switches to feet; in metres, to metres.

  3. Areas and perimeters.
     Tick Area and/or Perimeter: each markup in the list shows its values, the list
     header shows the total and the panel the total of the selection. Only what is visible
     counts: the part of a markup that is erased or covered by a markup above it is left
     out, so the total equals the area coloured on the sheet.
     - Tags: writes the values inside each markup on the sheet. A tag sits at the most
       open spot, clear of the drawing's own text; drag it to move it (right-click the
       markup to put it back). Tags print.
     - Legend: adds Area and Perimeter columns to the legend, with a total row (merged
       rows are added up).

  4. Dimensions (K).
     Click two points, then click where the dimension line goes (or press Enter to keep
     it on the points). Points snap to walls and lines; Shift keeps it horizontal or
     vertical; hold Ctrl to place freely. On PDF drawings snapping uses the drawing's own
     geometry, so a dimension between two wall faces reads exactly what was drawn. With
     Select: drag an end to re-measure, the round dot to move the line, the dimension to
     move it; Delete removes it; the eraser removes those it passes over. Text size and
     colour are set under Measurements. Dimensions print.

  5. Schedules.
     Measurements > Schedule… (or Save as) writes every markup with its area and
     perimeter, totals by colour and the dimensions, as an Excel workbook (.xlsx, with
     the colour in each row and live SUM formulas) or a CSV file. A schedule needs a scale.

  Accuracy: a measurement is as good as the scale and the outline. A filled area follows
  the drawn lines to within a fraction of a millimetre on the sheet; polygons, rectangles
  and dimensions are exact. Good for quantities and checks, not for certified surveys.

WHAT'S NEW IN 1.1
  1. PDF export: highlights now show in every PDF reader.
     The cause was in how 1.0 wrote the highlights into the PDF: some readers could not
     find their transparency settings and left them out. Highlights are now written
     into the page itself in the plainest form PDF allows, and pictures inside the
     PDF are written in the form every reader accepts. Saved PDFs were checked in four
     independent PDF engines, including the one in Chrome and Edge. The drawing stays
     vector, its text stays searchable, and its layers keep their on/off settings. Also new: "Save as flattened PDF" puts the
     whole finished sheet in as one picture, for programs that handle nothing else.

  2. Rectangle guides (R).
     Before the first click a crosshair follows the pointer across the whole sheet and
     snaps to the faces of walls and lines (it turns orange when it snaps). After the
     first click the rectangle, its edges and its width and height show while you
     move. Sizes are in metres at the drawing scale, read from the title block
     ("1:50"); set or clear the scale in the bar at the bottom. To give an exact
     size, type the width after the first click, press Tab, type the height and
     press Enter. Shift keeps it square; hold Ctrl to place corners freely.

  3. Border line styles.
     Under the Border slider, "Line" offers solid, dashed, short dash, dotted,
     dash-dot and dash-dot-dot. The style shows on the sheet, in the legend, in
     pictures and in PDFs. Picking a style for a markup without a border gives it a
     1.5 pt border. Several selected markups change together.

  4. Find painted colour (D), reworked.
     - Finds pale tints and keeps close shades apart (two greens stay two colours).
     - "Colour match" (strict, normal, loose) and "Smallest area" tune the search.
     - "Find hatched areas too" finds zones drawn with coloured hatching.
     - "Find a colour I click on the sheet" looks for exactly that colour; this is
       also how to find grey zones (greys are never picked up on their own, so walls
       and poché are left alone).
     - Click an outlined area on the sheet to leave it out, click again to add it back.
     - Make one markup per area, or one per colour.
     - Markups are named from the room labels inside them. Solid paint comes back at
       full strength (the sheet looks as before); hatching becomes a normal
       see-through highlight. Painted markups go under the highlights you drew.
     - The panel moves out of the way of what it found; drag its title to move it.

  5. Eraser (E) removes colour that is already in the drawing.
     - Drag: removes the colour under the brush (fills, coloured lines, grey zones).
       Black and grey line work, text and paper are kept.
     - Shift+click: removes a whole highlight, or a whole coloured area of the drawing.
     - Right-click on the sheet: "Remove colour in this area of the drawing".
     - The bar at the bottom chooses what to erase: Both, Highlights or Drawing colour.
       [ and ] change the brush size.
     - Every erase is one undo step. Removed colour stays removed in saved projects,
       pictures and PDFs.

FIRST STEPS
  1. Open a PDF or picture: Ctrl+O, or drop the file on the window.
     PDFs and multi-page TIFFs ask which page to open.
  2. Fill rooms with F (one click per room), or draw polygons (P) and rectangles (R).
     Each markup gets a name from the room label inside it when the PDF has text.
  3. Check the scale under Measurements (Calibrate with C if needed) and tick what to
     measure. Add dimensions with K.
  4. Press L to place the legend, then Ctrl+S to save. Save asks for the kind of file
     (PlanTint project, PDF, flattened PDF, PNG, JPEG, or an Excel or CSV schedule) and
     then where to put it.
  5. On site: turn on the Progress map to colour zones by status, and drop snag pins (X)
     with notes and photos. Both have their own Excel report.
  Press F1 inside PlanTint to see every key.

GOOD TO KNOW
  - Highlights tint the paper like a marker, so lines and text stay readable. On a
    drawing that is already coloured they replace that colour (see 1.5.1).
  - Existing markups act as walls for Fill. Gap lines (G) close door openings;
    they are never printed.
  - If a fill would spill over most of the sheet, PlanTint asks before filling.
  - Pictures saved from PlanTint keep the drawing's resolution and print size.
  - Unsaved work is copied every 90 seconds and offered back after a crash.
  - Projects saved by 1.0 to 1.6 open in 1.7 (a scale typed in 1.1 is kept).

LICENCES
  PlanTint uses Electron (MIT), MuPDF (AGPL-3.0), Clipper (Boost), UTIF (MIT),
  fflate (MIT), IBM Plex fonts (SIL OFL) and Lucide icons (ISC).
  Because MuPDF is AGPL, the complete source of this program is included in
  PlanTint-1.7.1-source.zip.
