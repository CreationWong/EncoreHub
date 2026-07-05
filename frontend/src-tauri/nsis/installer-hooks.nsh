!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\log"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
