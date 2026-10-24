; PlanTint installer additions (electron-builder includes this file at the top of the installer script).
;
; One progress bar for the whole installation. The app's files are unpacked by the Nsis7z plugin,
; which fills the page's progress bar from empty to full by itself; then the installer's own step
; counter takes the bar back to where it has got to and fills it again, so the bar used to fill two
; or three times. Now the page shows a bar of its own in the same place: unpacking moves it from 0 to
; 92%, the last steps (copying into place, shortcuts, registry, file types) take it to 100%, and the
; step counter keeps the page's original bar, hidden.
;
; The plugin finds the bar by its control id (1004) when it starts unpacking; the step counter takes
; the bar with that id when the installation starts. So ours gets the id only once the installation
; has started (the first, hidden section below) and gives it back once the files are unpacked.

!ifndef BUILD_UNINSTALLER
  Var plantintBar   ; the bar the page shows
  Var plantintOrig  ; the page's own bar, kept by the step counter

  Section "-plantintBar"
    StrCmp $plantintBar "" plantintBarSkip
    System::Call "user32::SetWindowLong(p $plantintOrig, i -12, i 1099)"
    System::Call "user32::SetWindowLong(p $plantintBar, i -12, i 1004)"
    plantintBarSkip:
  SectionEnd
!endif

; the installing page: our bar over the original one
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW plantintInstFilesShow

  Function plantintInstFilesShow
    FindWindow $0 "#32770" "" $HWNDPARENT
    GetDlgItem $1 $0 1004
    ${if} $1 == 0
      Return
    ${endif}
    ; where the page's own bar is, in the page's coordinates
    System::Call "*(i 0, i 0, i 0, i 0) p .r2"
    System::Call "user32::GetWindowRect(p r1, p r2)"
    System::Call "user32::MapWindowPoints(p 0, p r0, p r2, i 2)"
    System::Call "*$2(i .r3, i .r4, i .r5, i .r6)"
    System::Free $2
    IntOp $5 $5 - $3
    IntOp $6 $6 - $4
    ; the same kind of bar (its style, made visible: 0x10000000 = WS_VISIBLE) in the same place
    System::Call "user32::GetWindowLong(p r1, i -16) i .r8"
    IntOp $8 $8 | 0x10000000
    System::Call "user32::CreateWindowEx(i 0, t 'msctls_progress32', t '', i r8, i r3, i r4, i r5, i r6, p r0, p 1098, p 0, p 0) p .r7"
    ${if} $7 == 0
      Return
    ${endif}
    ShowWindow $1 ${SW_HIDE}
    StrCpy $plantintOrig $1
    StrCpy $plantintBar $7
    ; the plugin counts 0 to 30000: that is 0 to 92% of 0..32609
    SendMessage $plantintBar 0x406 0 32609   ; PBM_SETRANGE32
    SendMessage $plantintBar 0x402 0 0       ; PBM_SETPOS
  FunctionEnd
!macroend

!macro plantintBarAt POS
  ${if} $plantintBar != ""
    SendMessage $plantintBar 0x402 ${POS} 0
  ${endif}
!macroend

; unpacked and copied into place: the id goes back to the page's own bar, ours shows 94%
!macro customFiles_x64
  ${if} $plantintBar != ""
    System::Call "user32::SetWindowLong(p $plantintBar, i -12, i 1098)"
    System::Call "user32::SetWindowLong(p $plantintOrig, i -12, i 1004)"
  ${endif}
  !insertmacro plantintBarAt 30652
!macroend

; registry, shortcuts and file types done: full
!macro customInstall
  !insertmacro plantintBarAt 32609
!macroend
