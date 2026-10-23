PlanTint 1.4.1
Highlighting and measuring for architectural and technical drawings.

INSTALL
  PlanTint-Setup-1.4.1.exe
      Installs for your Windows user only (no admin rights needed), adds Start menu and
      desktop shortcuts, and opens .plantint project files when you double-click them.
      Recommended. Installing over an earlier version keeps your settings.

  PlanTint-1.4.1-portable.exe
      One file, nothing installed. It unpacks itself each time, so it starts a few
      seconds slower than the installed version.

  The program is not code-signed, so Windows may show "Windows protected your PC".
  Click "More info", then "Run anyway".

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
  Press F1 inside PlanTint to see every key.

GOOD TO KNOW
  - Highlights tint the paper like a marker, so lines and text stay readable.
  - Existing markups act as walls for Fill. Gap lines (G) close door openings;
    they are never printed.
  - If a fill would spill over most of the sheet, PlanTint asks before filling.
  - Pictures saved from PlanTint keep the drawing's resolution and print size.
  - Unsaved work is copied every 90 seconds and offered back after a crash.
  - Projects saved by 1.0 to 1.3 open in 1.4 (a scale typed in 1.1 is kept).

LICENCES
  PlanTint uses Electron (MIT), MuPDF (AGPL-3.0), Clipper (Boost), UTIF (MIT),
  fflate (MIT), IBM Plex fonts (SIL OFL) and Lucide icons (ISC).
  Because MuPDF is AGPL, the complete source of this program is included in
  PlanTint-1.4.1-source.zip.
