/*
 * pdic-conv.js v0.2
 *
 * Copyright (c) 2017 na2co3
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
 * 文字コード(options):
 *   -unicode: UTF-16LE(BOM有り) PDICやTWOCなど (デフォルト)
 *   -utf8: UTF-8(BOM無し) 幻日辞典など
 */

/*
 * 未対応: 単語レベル, 暗記マーク, 修正マーク, ファイルリンクや埋め込みファイル
 *         圧縮されたバイナリ, 暗号化
 */

const fs = require("fs");
const bocu1 = require("./bocu1");

function main() {
	let dicFile, outFile, format = 0, encoding = 0;
	let match;
	if (process.argv[2]) {
		dicFile = process.argv[2];
		process.argv.slice(3).forEach(function (arg) {
			if (arg.substr(0, 1) == "-") {
				if (arg == "-csv")
					format = 0;
				else if (arg == "-text")
					format = 1;
				else if (arg == "-1line")
					format = 2;
				else if (arg == "-unicode")
					encoding = 0;
				else if (arg == "-utf8")
					encoding = 1;
			}
		});
		if (process.argv[3] && process.argv[3].substr(0, 1) != "-") {
			outFile = process.argv[3];
		} else {
			if (match = dicFile.match(/^(.*)\.[^\\\.]*$/)) {
				outFile = match[1] + [".csv", ".txt", ".txt"][format];
			} else {
				outFile = dicFile + [".csv", ".txt", ".txt"][format];
			}
		}
	} else {
		console.log("node pdic-conv dicFile [outputFile]");
		process.exit();
	}

	let ret;

	try {
		if (format == 0) { // CSV
			ret = "word,trans,exp,level,memory,modify,pron";
			readPDIC(dicFile, function (entry) {
				ret += '\r\n"' + entry.word.replace(/"/g, '""') + '","' +
					entry.trans.replace(/"/g, '""') + '","' +
					(entry.exp || "").replace(/"/g, '""') + '",' +
					(entry.level || 0) + ',' + (entry.memory || 0) + ',' + (entry.modify || 0) + ',"' +
					(entry.pron || "").replace(/"/g, '""') + '"';
			});
		} else if (format == 2) { // 1 line text
			ret = "";
			let firstLine = true;
			readPDIC(dicFile, function (entry) {
				ret += (firstLine ? "" : "\r\n") + entry.word + " /// " +
					entry.trans.replace(/\r?\n/g, " \\ ") + " / ";
				if (entry.exp) {
					ret += entry.exp.replace(/\r?\n/g, " \\ ");
				}
				firstLine = false;
			});
		} else { // text
			ret = "";
			readPDIC(dicFile, function (entry) {
				ret += entry.word + "\r\n" + entry.trans;
				if (entry.exp)
					ret += " / " + entry.exp;
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
 *     level   : 単語レベル (未対応)
 *     memory  : 暗記マーク (未対応)
 *     modify  : 修正マーク (未対応)
 *     pron    : 発音記号
 *     linkdata: ファイルリンク又は埋め込みファイル (未対応)
 *    }
 */
function readPDIC(file, writeEntry) {
	let dic = new SeekableFile(fs.openSync(file, "r"));
	let headerBuf = new Buffer(256);
	dic.read(headerBuf, 256);

	// --- header ---
	let header = {};
	// header.headername = headerBuf.toString("ascii", 0, 0x64);
	header.version = headerBuf.readInt16LE(0x8c);
	if (header.version >> 8 != 6) {
		throw new FormatError("Error: 非対応のバージョンです。バージョン: 0x" + header.version.toString(16));
	}
	header.index_block = headerBuf.readUInt16LE(0x94);
	// header.nword = headerBuf.readUInt32LE(0xa0);
	header.dictype = headerBuf.readUInt8(0xa5); // 1:バイナリを圧縮, 8:BOCU-1, 64:暗号化
	if (header.dictype & 64)
		throw new FormatError("Error: 暗号化された辞書には対応していません");
	// header.olenumber = headerBuf.readInt32LE(0xa8);
	header.index_blkbit = headerBuf.readUInt8(0xb6); //0:16bit, 1:32bit
	header.extheader = headerBuf.readUInt32LE(0xb8);
	// header.empty_block2 = headerBuf.readInt32LE(0xbc);
	header.nindex2 = headerBuf.readUInt32LE(0xc0);
	header.nblock2 = headerBuf.readUInt32LE(0xc4);
	// header.cypt = headerBuf.slice(0xc8,0xd0);
	// header.dicident = headerBuf.slice(0xd8,0xe0);

	// --- index ---
	let indexOffset = 1024 + header.extheader;
	let index = new Array(header.nindex2), index_id;
	let blockIDBuf = new Buffer(4), indexWordBuf = new Buffer(1);
	dic.seek(indexOffset);
	for (index_id = 0; index_id < header.nindex2; index_id++) {
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
	let blockOffset = indexOffset + (header.index_block << 10);
	let blockSpanBuf = new Buffer(2), blockSpan, fieldLengthBit;
	let fieldLengthBuf = new Buffer(4), fieldLength;
	let omitLengthBuf = new Buffer(1), omitLength;
	let wordFlagBuf = new Buffer(1);
	let fieldBuf, prevWord, fieldPtr;
	let extFlag, extSize, extContentBuf;
	let entry;
	let tmp;
	for (index_id = 0; index_id < header.nindex2; index_id++) {
		dic.seek(blockOffset + (index[index_id] << 10));
		dic.read(blockSpanBuf, 2);
		blockSpan = blockSpanBuf.readUInt16LE(0);
		if (blockSpan === 0)
			continue;
		fieldLengthBit = !!(blockSpan & 0x8000); // 0:16bit, 1:32bit
		blockSpan &= 0x7fff;
		prevWord = "";

		while (true) {
			if (!fieldLengthBit) { // 16bit
				dic.read(fieldLengthBuf, 2);
				fieldLength = fieldLengthBuf.readUInt16LE(0);
			} else { // 32bit
				dic.read(fieldLengthBuf, 4);
				fieldLength = fieldLengthBuf.readUInt32LE(0);
			}
			if (fieldLength === 0)
				break;
			dic.read(omitLengthBuf, 1);
			omitLength = omitLengthBuf[0];
			dic.read(wordFlagBuf, 1);
			if (wordFlagBuf[0] == 0xff)
				continue; // リファレンス登録語(Ver.6.10で廃案)
			entry = {};
			fieldBuf = new Buffer(fieldLength);
			dic.read(fieldBuf, fieldLength);
			tmp = sliceBufferUntilNull(fieldBuf, 0);
			entry.word = prevWord.substr(0,omitLength) + bocu1.decode(tmp.buffer);
			tmp = sliceBufferUntilNull(fieldBuf, tmp.next);
			entry.trans = bocu1.decode(tmp.buffer);
			if (tmp.next < fieldLength) { // 拡張構成
				fieldPtr = tmp.next;
				while (true) {
					extFlag = fieldBuf[fieldPtr];
					if ((extFlag & 0xf0) === 0) { // テキストデータ
						tmp = sliceBufferUntilNull(fieldBuf, fieldPtr + 1);
						extContentBuf = tmp.buffer;
						fieldPtr = tmp.next;
					} else if (extFlag & 0x80) { //拡張終了
						break;
					} else if (extFlag & 0x10) { // バイナリデータ
						if (!fieldLengthBit) { // 16bit
							extSize = fieldBuf.readUInt16LE(fieldPtr);
							fieldPtr += 2;
						} else { // 32bit
							extSize = fieldBuf.readUInt32LE(fieldPtr);
							fieldPtr += 4;
						}
						extContentBuf = fieldBuf.slice(fieldPtr, fieldPtr + extSize);
						fieldPtr += extSize;
						if (extFlag & 0x40) {} // 圧縮データ
					} else { // ?
						tmp = sliceBufferUntilNull(fieldBuf, fieldPtr + 1);
						extContentBuf = tmp.buffer;
						fieldPtr = tmp.next;
					}
					extFlag &= 0x0f; //1:exp, 2:pron, 4:linkdata
					if (extFlag == 1)
						entry.exp = bocu1.decode(extContentBuf);
					else if (extFlag == 2)
						entry.pron = bocu1.decode(extContentBuf);
				}
			}
			tmp = entry.word.indexOf("\t");
			if (tmp >= 0) {
				entry.keyword = entry.word.substr(0, tmp);
				entry.word = entry.word.substr(tmp + 1);
			} else {
				entry.keyword = entry.word;
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