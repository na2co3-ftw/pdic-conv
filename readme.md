# pdic-conv v0.2

PDICのDIC形式をCSVや一行テキストなどに変換できるコマンドラインツールです。

使用する前に[Node.js](https://nodejs.org/ja/)をインストールしておいて下さい。

## 使い方
pdic-conv.jsの存在するフォルダでコマンドラインを開いて  
`node pdic-conv ***.dic [出力先ファイル] [options...]`

出力先ファイル: 省略した場合、入力ファイルの拡張子を出力形式に合わせて変更したものを使用します

形式(options):
* `-csv` : CSV形式 (デフォルト)
* `-text` : テキスト形式,
* `-1line` : 1行テキスト形式

文字コード(options):
* `-unicode` : UTF-16LE(BOM有り) PDICやTWOCなど (デフォルト)
* `-utf8` : UTF-8(BOM無し) 幻日辞典など
