!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithNeuron" "" "Open in Neuron"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithNeuron" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithNeuron\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%V$\""

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithNeuron" "" "Open in Neuron"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithNeuron" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithNeuron\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%V$\""
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenWithNeuron"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenWithNeuron"
!macroend
