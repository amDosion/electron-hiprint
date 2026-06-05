!macro customInstall
  ; 如果安装包路径下存在 config.json 文件，仅在用户配置不存在时导入，避免升级覆盖现有设置。
  IfFileExists "$EXEDIR\config.json" 0 SkipConfigSeed
  IfFileExists "$APPDATA\electron-hiprint\config.json" SkipConfigSeed 0
  CreateDirectory "$APPDATA\electron-hiprint"
  CopyFiles "$EXEDIR\config.json" "$APPDATA\electron-hiprint\config.json"
  SkipConfigSeed:
  ; 删除旧的 hiprint 伪协议
  DeleteRegKey HKCR "hiprint"
  ; 注册 hiprint 伪协议
  WriteRegStr HKCR "hiprint" "" "URL:hiprint"
  WriteRegStr HKCR "hiprint" "URL Protocol" ""
  WriteRegStr HKCR "hiprint\shell" "" ""
  WriteRegStr HKCR "hiprint\shell\Open" "" ""
  WriteRegStr HKCR "hiprint\shell\Open\command" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME} %1"
!macroend

!macro customUnInstall
  ; 升级安装会以 /S /KEEP_APP_DATA --updated 调用旧卸载器；此路径必须保留本地配置。
  ${if} ${isUpdated}
    Goto SkipDataDeletion
  ${endif}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${ifNot} ${Errors}
    Goto SkipDataDeletion
  ${endif}
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${ifNot} ${Errors}
    Goto DeleteAppData
  ${endif}
  ${if} ${Silent}
    Goto SkipDataDeletion
  ${endif}
  ; 仅在手动交互式卸载时询问用户是否需要清除本地缓存数据
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除本地缓存数据？$\n这将清除所有设置和历史记录。" IDNO SkipDataDeletion
  DeleteAppData:
  RMDir /r "$APPDATA\electron-hiprint"
  SkipDataDeletion:
  ; 删除 hiprint 伪协议
  DeleteRegKey HKCR "hiprint"
!macroend
