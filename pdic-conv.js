/*
 * pdic-conv.js v0.5
 *
 * Copyright (c) 2015-2019 na2co3
 * Released under the MIT License, see:
 * http://opensource.org/licenses/mit-license.php
 */

/*
 * 使い方:
 *   node pdic-conv ***.dic [出力先ファイル] [options...]
 *
 * 出力先ファイル: 省略した場合、入力ファイルの拡張子を出力形式に合わせて変更したものを使用します
 *
 * 形式(options):
 *   -csv  : CSV形式 (デフォルト)
 *   -text : テキスト形式,
 *   -1line: 1行テキスト形式
 *
 * 詳細設定(options):
 *   -keyword: 指定するとCSV型式でキーワードの項目を出力する
 *
 * 文字コード(options):
 *   -unicode: UTF-16LE(BOM有り) PDICやTWOCなど (デフォルト)
 *   -utf8   : UTF-8(BOM無し) 幻日辞典など
 */

/*
 * 未対応: 圧縮, 暗号化, ファイルリンクや埋め込みファイルやOLEオブジェクト
 */

const fs = require("fs");
const bocu1 = require("./bocu1");

function main() {
	let dicFile, outFile, format = 0, encoding = 0, keyword = false;
	if (process.argv[2]) {
		dicFile = process.argv[2];
		process.argv.slice(3).forEach(function (arg) {
			if (arg.substr(0, 1) == "-") {
				switch (arg) {
				case "-csv":
					format = 0;
					break;
				case "-text":
					format = 1;
					break;
				case "-1line":
					format = 2;
					break;
				case "-unicode":
					encoding = 0;
					break;
				case "-utf8":
					encoding = 1;
					break;
				case "-keyword":
					keyword = true;
					break;
				}
			}
		});
		if (process.argv[3] && process.argv[3].substr(0, 1) != "-") {
			outFile = process.argv[3];
		} else {
			let match;
			if ((match = dicFile.match(/^(.*)\.[^\\\.]*$/)) != null) {
				outFile = match[1] + [".csv", ".txt", ".txt"][format];
			} else {
				outFile = dicFile + [".csv", ".txt", ".txt"][format];
			}
		}
	} else {
		console.log("node pdic-conv dicFile [outputFile]");
		process.exit();
	}

	let ret = "";

	try {
		if (format == 0) { // CSV
			if (keyword) {
				ret += "keyword,";
			}
			ret += "word,trans,exp,level,memory,modify,pron";

			readPDIC(dicFile, function (entry) {
				ret += "\r\n";
				if (keyword) {
					ret += `"${entry.keyword.replace(/"/g, '""')}",`;
				}
				ret += `"${entry.word.replace(/"/g, '""')}",`;
				ret += `"${entry.trans.replace(/"/g, '""')}",`;
				ret += `"${(entry.exp || "").replace(/"/g, '""')}",`;
				ret += (entry.level || 0) + ",";
				ret += (entry.memory ? 1 : 0) + ",";
				ret += (entry.modify ? 1 : 0) + ",";
				ret += `"${(entry.pron || "").replace(/"/g, '""')}"`;
			});
		} else if (format == 2) { // 1 line text
			ret = "";
			let firstLine = true;
			readPDIC(dicFile, function (entry) {
				if (firstLine) {
					ret += "\r\n";
					firstLine = false;
				}
				ret += entry.word + " /// " + entry.trans.replace(/\r?\n/g, " \\ ");
				if (entry.exp) {
					ret += " / " + entry.exp.replace(/\r?\n/g, " \\ ");
				}
			});
		} else { // text
			ret = "";
			readPDIC(dicFile, function (entry) {
				ret += entry.word + "\r\n" + entry.trans;
				if (entry.exp) {
					ret += " / " + entry.exp;
				}
				ret += "\r\n";
			});
		}
	} catch(e) {
		if (e instanceof FormatError) {
			console.log(e.message);
		} else {
			throw e;
		}
	}

	if (encoding == 0) { // Unicode
		fs.writeFileSync(outFile, "\ufeff" + ret, "utf16le");
	} else { // UTF-8
		fs.writeFileSync(outFile, ret, "utf8");
	}
}

class FormatError {
	constructor(message) {
		this.message = message;
	}
}

class SeekableFile {
	constructor(fd) {
		this.fd = fd;
		this.position = 0;
	}

	read(buffer, length) {
		fs.readSync(this.fd, buffer, 0, length, this.position);
		this.position += length;
	}

	seek(position) {
		this.position = position;
	}

	skip(length) {
		this.position += length;
	}
}

/*
 * DICファイルを開いて読み込む
 * file      : DICファイルのパス
 * writeEntry: コールバック関数。第1引数にエントリーオブジェクトが渡される
 *             DICファイル内のデータ順にそって各エントリーごとに呼ばれる
 *
 *   エントリーオブジェクト: {
 *     keyword : 見出語の検索キー
 *     word    : 見出語
 *     trans   : 訳語
 *     exp     : 用例
 *     level   : 単語レベル
 *     memory  : 暗記必須マーク
 *     modify  : 修正マーク
 *     pron    : 発音記号
 *     linkdata: ファイルリンク又は埋め込みファイル (未対応)
 *    }
 */
function readPDIC(file, writeEntry) {
	const contents = fs.readFileSync(file);
	console.log("Header: " + contents.slice(0, 256).toString("hex"));

	let dic = new SeekableFile(fs.openSync(file, "r"));
	let headerBuf = Buffer.alloc(256);
	dic.read(headerBuf, 256);
	console.log("Header buffer: " + headerBuf.toString("hex"));

	// --- header ---
	let header = {};
	// header.headername = headerBuf.toString("ascii", 0, 100);
	console.log("Version buffer: " + headerBuf.slice(0x8c, 0x8e).toString("hex"));
	header.version = headerBuf.readInt16LE(0x8c);
	console.log("Version: " + header.version);
	if (header.version >> 8 != 6) {
		throw new FormatError("Error: 辞書ファイルが正しくないか、非対応のバージョンです。バージョン: 0x" + header.version.toString(16));
	}
	header.index_block = headerBuf.readUInt16LE(0x94);
	// header.nword = headerBuf.readUInt32LE(0xa0);
	header.dictype = headerBuf.readUInt8(0xa5); // 0x01:バイナリを圧縮, 0x08:BOCU-1, 0x40:暗号化
	if (header.dictype & 64) {
		throw new FormatError("Error: 辞書が暗号化されています。");
	}
	// header.olenumber = headerBuf.readInt32LE(0xa8);
	header.index_blkbit = headerBuf.readUInt8(0xb6); //0:16bit, 1:32bit
	header.extheader = headerBuf.readUInt32LE(0xb8);
	// header.empty_block2 = headerBuf.readInt32LE(0xbc);
	header.nindex2 = headerBuf.readUInt32LE(0xc0);
	// header.nblock2 = headerBuf.readUInt32LE(0xc4);
	// header.cypt = headerBuf.slice(0xc8, 0xc8 + 8);
	// header.dicident = headerBuf.slice(0xd8, 0xd8 + 8);

	// --- index ---
	let indexOffset = 1024 + header.extheader;
	let index = new Array(header.nindex2);
	let blockIDBuf = Buffer.alloc(4);
	let indexWordBuf = Buffer.alloc(1);
	dic.seek(indexOffset);
	for (let index_id = 0; index_id < header.nindex2; index_id++) {
		if (!header.index_blkbit) { // 16bit index
			dic.read(blockIDBuf, 2);
			index[index_id] = blockIDBuf.readUInt16LE(0);
		} else {  // 32bit index
			dic.read(blockIDBuf, 4);
			index[index_id] = blockIDBuf.readUInt32LE(0);
		}
		do {
			dic.read(indexWordBuf, 1);
		} while (indexWordBuf[0] !== 0);
	}

	// --- data block ---
	let dataOffset = indexOffset + (header.index_block * 1024);
	let blockSpanBuf = Buffer.alloc(2);
	let fieldLengthBuf = Buffer.alloc(4);
	let omitLengthBuf = Buffer.alloc(1);
	let wordFlagBuf = Buffer.alloc(1);
	let tmp;
	for (let index_id = 0; index_id < header.nindex2; index_id++) {
		dic.seek(dataOffset + (index[index_id] * 1024));
		dic.read(blockSpanBuf, 2);
		let blockSpan = blockSpanBuf.readUInt16LE(0);
		if (blockSpan === 0) { // 空ブロック
			continue;
		}
		let fieldLengthBit = !!(blockSpan & 0x8000); // 0:16bit, 1:32bit
		// blockSpan &= 0x7fff;

		let prevRawWord = Buffer.alloc(0);
		while (true) {
			let entry = {};

			let fieldLength;
			if (!fieldLengthBit) { // 16bit
				dic.read(fieldLengthBuf, 2);
				fieldLength = fieldLengthBuf.readUInt16LE(0);
			} else { // 32bit
				dic.read(fieldLengthBuf, 4);
				fieldLength = fieldLengthBuf.readUInt32LE(0);
			}
			if (fieldLength === 0) {
				break;
			}

			dic.read(omitLengthBuf, 1);
			let omitLength = omitLengthBuf[0];

			dic.read(wordFlagBuf, 1);
			let wordFlag = wordFlagBuf[0];
			if (wordFlag == 0xff) {
				dic.skip(fieldLength);
				continue; // リファレンス登録語(Ver.6.10で廃案)
			}
			entry.memory = !!(wordFlag & 0x20);
			entry.modify = !!(wordFlag & 0x40);
			entry.level = wordFlag & 0x0f;

			let fieldBuf = Buffer.alloc(fieldLength);
			dic.read(fieldBuf, fieldLength);

			tmp = sliceBufferUntilNull(fieldBuf, 0);
			tmp.buffer = Buffer.concat([prevRawWord.slice(0, omitLength), tmp.buffer]);
			try {
				entry.word = bocu1.decode(tmp.buffer);
			} catch(e) {
				console.log(`WARNING: 見出し語のデコードに失敗しました : ${tmp.buffer.toString("hex")}`);
				entry.word = "";
			}
			prevRawWord = tmp.buffer;

			let nameSplitIndex = entry.word.indexOf("\t");
			if (nameSplitIndex >= 0) {
				entry.keyword = entry.word.substr(0, nameSplitIndex);
				entry.word = entry.word.substr(nameSplitIndex + 1);
			} else {
				entry.keyword = entry.word;
			}

			tmp = sliceBufferUntilNull(fieldBuf, tmp.next);
			try {
				entry.trans = bocu1.decode(tmp.buffer);
			} catch(e) {
				console.log(`WARNING: 訳語のデコードに失敗しました : ${entry.word} : ${tmp.buffer.toString("hex")}`);
				entry.trans = "";
			}

			if (wordFlag & 0x10) { // 拡張構成
				let fieldPtr = tmp.next;
				while (fieldPtr < fieldBuf.length) {
					let extFlag = fieldBuf[fieldPtr];
					let extType = extFlag & 0x0f; //1:exp, 2:pron, 4:linkdata
					if (extType & 0x80) {
						break;
					}
					fieldPtr++;

					if (!(extFlag & 0x10)) { // テキストデータ
						tmp = sliceBufferUntilNull(fieldBuf, fieldPtr);
						fieldPtr = tmp.next;

						let content;
						try {
							content = bocu1.decode(tmp.buffer);
						} catch(e) {
							console.log(`WARNING: ${extType == 1 ? "例文" : extType == 2 ? "発音" : "拡張データ(" + extType + ")"}のデコードに失敗しました : ${entry.word} : ${tmp.buffer.toString("hex")}`);
							continue;
						}
						if (extType == 1) {
							entry.exp = content;
							continue;
						} else if (extType == 2) {
							entry.pron = content;
							continue;
						} else if (extType == 0) {
							continue;
						}
						console.log(`Notice: 不明な拡張テキストデータ(${extType})が含まれています : ${entry.word} : "${content}"`)
					} else { // バイナリデータ
						let extSize;
						if (!fieldLengthBit) { // 16bit
							extSize = fieldBuf.readUInt16LE(fieldPtr);
							fieldPtr += 2;
						} else { // 32bit
							extSize = fieldBuf.readUInt32LE(fieldPtr);
							fieldPtr += 4;
						}
						fieldPtr += extSize;

						if (extType == 1) {
							console.log(`Notice: 訳語が圧縮されているかバイナリデータです。非対応のため無視します : ${entry.word}`);
						} else if (extType == 4) {
							console.log(`Notice: ファイルまたはオブジェクトが含まれています。非対応のため無視します : ${entry.word}`);
						} else if (extType == 0) {
							continue;
						} else {
							console.log(`Notice: 不明な拡張バイナリデータ(${extType})が含まれています : ${entry.word}`)
						}
					}
				}
			}
			writeEntry(entry);
		}
	}
}

function sliceBufferUntilNull(buffer, start) {
	let end = start;
	while (buffer[end] !== 0){
		end++;
		if (end >= buffer.length)
			break;
	}
	return {buffer: buffer.slice(start, end), next: end + 1};
}

main();