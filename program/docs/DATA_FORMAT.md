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

## 設備ごとの実データで確かめたこと（2026-10-27・DL2・LS3・LS4・NS1・TLV から 1 ロットずつ無作為に）

解析結果（scan_*.txt）から .dat を全バイトのまま作り直し（`program/tools/scan_rebuild.py`。SHA256 で一致を確かめる）、
`program/tools/real_data_check.py` で確かめた。定義の XML（InspectDataInfo.xml）は先頭しか無いので、欄の位置はデータから探した。

| 確かめたこと | 結果（5 設備とも） |
|---|---|
| 入れ物（頭 ＋ 件数 ×（1 件 ＋ 印 1 バイト）＝ 大きさ） | 60 ファイルすべて余り 0。印は 0。1 件のバイト数は設備によらず同じ（DETECT_INFO 394・INSP_INFO 306・IMAGE_LINK 12・STAT_INFO 424）。dirinfo.dat は別の形（読まない） |
| dataVersion | ファイルの値（DETECT_INFO 136402005 など）は定義の structure id（INSP_INFO は 1000）と合わない。定義の system_default の dataVersion で構造を選ぶ（アプリの読み方のとおり） |
| 日時 | INSP_INFO・DETECT_INFO とも Kind 0（時刻の種類なし）＝そのままの現地時刻。検査開始はフォルダ名の時刻と秒まで同じ。欠陥 12,460 件すべてが検査の間 |
| 画像と欠陥 | IMAGE_LINK の欠陥の記録の番号の記録に、同じ画像の ID がある（12,029 件すべて）。番号で引けば合う |
| 単位 | 検査長 insp_end_y と欠陥の長さ方向の位置は同じ単位（mm）。検査長(m) は × 0.001（サマリの表示項目の倍率） |
| 記録の種類 | 1＝欠陥・2＝多量（kindID 1100・LS3 397 件）・5（DL2 に 1 件。画像なし。欠陥に数えない） |

- ロット表は、表示項目と同じ項目（ファイル・鍵が同じ）を、表示項目と同じ倍率・日時の形で出す（版 4.2.0 では、検査長が mm のまま「(m)」の名前で出ていた。4.2.1 で直した）
