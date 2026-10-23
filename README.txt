PlanTint 1.1
Highlighting for architectural and technical drawings.

INSTALL
  PlanTint-Setup-1.1.0.exe
      Installs for your Windows user only (no admin rights needed), adds Start menu and
      desktop shortcuts, and opens .plantint project files when you double-click them.
      Recommended. Installing over 1.0 keeps your settings.

  PlanTint-1.1.0-portable.exe
      One file, nothing installed. It unpacks itself each time, so it starts a few
      seconds slower than the installed version.

  The program is not code-signed, so Windows may show "Windows protected your PC".
  Click "More info", then "Run anyway".

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
  3. Press L to place the legend, then Ctrl+S to save. Save asks for the kind of file
     (PlanTint project, PDF, flattened PDF, PNG or JPEG) and then where to put it.
  Press F1 inside PlanTint to see every key.

GOOD TO KNOW
  - Highlights tint the paper like a marker, so lines and text stay readable.
  - Existing markups act as walls for Fill. Gap lines (G) close door openings;
    they are never printed.
  - If a fill would spill over most of the sheet, PlanTint asks before filling.
  - Pictures saved from PlanTint keep the drawing's resolution and print size.
  - Unsaved work is copied every 90 seconds and offered back after a crash.
  - Projects saved by 1.0 open in 1.1.

LICENCES
  PlanTint uses Electron (MIT), MuPDF (AGPL-3.0), Clipper (Boost), UTIF (MIT),
  fflate (MIT), IBM Plex fonts (SIL OFL) and Lucide icons (ISC).
  Because MuPDF is AGPL, the complete source of this program is included in
  PlanTint-1.1.0-source.zip.
