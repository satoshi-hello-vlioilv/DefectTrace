# 検査データの形（実データで確かめた物: LS3 2026_10_25_22_03_53・2026_10_23_21_27_46・2026_10_24_19_42_05）

- `.dat`: `int32 頭の長さ`・`int32 dataVersion`（= option/InspectDataInfo.xml の structure id）・`int32 1 件のバイト数`・`byte 名前の長さ + 名前`、
  そのあと `[1 byte の印 + 1 件分]` の繰り返し。長さの無い String の欄は、1 件の残りのバイト。Byte[] の欄は読まない
- DateTime（8 バイト）: 2 ビットの Kind ＋ 62 ビットの tick（100ns・0001-01-01 から）。保存の仕方が 2 通り（ToBinary＝Kind が Local/Utc の値は UTC・
  構造体のまま＝現地時刻）。ファイルごとに、ロットのフォルダ名の時刻に近い方で決める（時差は config の `utc_offset_hours`）
- 画像 N.bmp → IMAGE_LINK（image_fileno=N）→ DETECT_INFO[detect_recno]（recno が合わなければ image_id で）
- 幅方向OS～(mm) = x_mm − base_x ／ 長さ方向(m) = y_mm ÷ 1000 ／ 検査幅 = INSP_INFO の insp_area_ed − insp_area_st
- 分類 = cond/COND*.xml の classification_conditions[kindID]、面 = cond/Common.xml の group_conditions[group]
- DETECT_INFO の type≠1 は欠陥以外の記録（多量: type=2・kindID=1100。件数は INSP_INFO.error_count）
- 画像の置き方: CAB（img/0000.cab …・LS3・LS4・TLV）／フォルダ（img/0000/*.bmp・DL2）／直下（img/*.bmp）
