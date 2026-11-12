; Custom NSIS script for Paperweight
; Adds "Open with Paperweight" Explorer context menu for PDF documents and all image formats

!macro customInit
  ; Ensure any running Paperweight process is terminated before setup proceeds
  nsExec::Exec `taskkill /F /T /IM "Paperweight.exe"`
  Pop $0
  Sleep 500
  ; Remove stale uninstaller registry keys from legacy versions that had uninstaller bugs
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\13627e86-252f-5cf8-80a0-2ef9ecd8235f"
  DeleteRegKey HKCU "Software\13627e86-252f-5cf8-80a0-2ef9ecd8235f"
!macroend

!macro customCheckAppRunning
  ; Gracefully close any running instance of Paperweight.exe before installing without false-positive self-lock
  nsExec::Exec `taskkill /F /T /IM "Paperweight.exe"`
  Pop $0
  Sleep 500
!macroend

!macro customUnInit
  ; Close any running instance of Paperweight before uninstalling
  nsExec::Exec `taskkill /F /T /IM "Paperweight.exe"`
  Pop $0
  Sleep 500
!macroend

!macro customInstall
  DetailPrint "Registering Paperweight Explorer context menu associations..."
  
  ; Context menu for all images (JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF)
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\Paperweight" "" "Open with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\Paperweight" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\Paperweight\command" "" '"$appExe" "%1"'

  ; "Resize with Paperweight" context menu for all images
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\PaperweightResize" "" "Resize with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\PaperweightResize" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\PaperweightResize\command" "" '"$appExe" --action=resize "%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\PaperweightResize" "" "Resize with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\PaperweightResize" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\PaperweightResize\command" "" '"$appExe" --action=resize "%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\PaperweightResize" "" "Resize with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\PaperweightResize" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\PaperweightResize\command" "" '"$appExe" --action=resize "%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\PaperweightResize" "" "Resize with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\PaperweightResize" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\PaperweightResize\command" "" '"$appExe" --action=resize "%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\PaperweightResize" "" "Resize with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\PaperweightResize" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\PaperweightResize\command" "" '"$appExe" --action=resize "%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.bmp\shell\PaperweightResize" "" "Resize with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.bmp\shell\PaperweightResize" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.bmp\shell\PaperweightResize\command" "" '"$appExe" --action=resize "%1"'

  ; Context menu for PDF documents
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\Paperweight" "" "Open with Paperweight"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\Paperweight" "Icon" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\Paperweight\command" "" '"$appExe" "%1"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Paperweight Explorer context menu associations..."
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\image\shell\Paperweight"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\image\shell\PaperweightResize"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\PaperweightResize"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\PaperweightResize"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\PaperweightResize"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webp\shell\PaperweightResize"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.bmp\shell\PaperweightResize"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\Paperweight"
!macroend
