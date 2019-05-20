/*
******************************************************************************
*
*   Copyright (C) 2002, International Business Machines
*   Corporation and others.  All Rights Reserved.
*
*   Modified and Optimized for PDIC by TaN 2002.6.9
*   Ported to Node.js by na2co3 2015.8.28
*
*   For licensing terms see the ICU X License:
*   http://source.icu-project.org/repos/icu/icu/trunk/license.html
*
******************************************************************************
*   file name:  bocu1.js
*   encoding:   US-ASCII
*   tab size:   4
*   indentation:1 tab
*
*   created on: 2002jan24
*   created by: Markus W. Scherer
*
*   This is a sample implementation of encoder and decoder functions for BOCU-1,
*   a MIME-compatible Binary Ordered Compression for Unicode.
*/
/* Copyright (C) 2003, TaN for PDIC modification */


/* BOCU-1 constants and macros ---------------------------------------------- */

/*
 * BOCU-1 encodes the code points of a Unicode string as
 * a sequence of byte-encoded differences (slope detection),
 * preserving lexical order.
 *
 * Optimize the difference-taking for runs of Unicode text within
 * small scripts:
 *
 * Most small scripts are allocated within aligned 128-blocks of Unicode
 * code points. Lexical order is preserved if the "previous code point" state
 * is always moved into the middle of such a block.
 *
 * Additionally, "prev" is moved from anywhere in the Unihan and Hangul
 * areas into the middle of those areas.
 *
 * C0 control codes and space are encoded with their US-ASCII bytes.
 * "prev" is reset for C0 controls but not for space.
 */

/* initial value for "prev": middle of the ASCII range */
var BOCU1_ASCII_PREV=        0x40;

/* bounding byte values for differences */
var BOCU1_MIN=               0x21;
var BOCU1_MIDDLE=            0x90;
var BOCU1_MAX_LEAD=          0xfe;
var BOCU1_MAX_TRAIL=         0xff;
var BOCU1_RESET=             0xff;

/* number of lead bytes */
var BOCU1_COUNT=             (BOCU1_MAX_LEAD-BOCU1_MIN+1);

/* adjust trail byte counts for the use of some C0 control byte values */
var BOCU1_TRAIL_CONTROLS_COUNT=  20;
var BOCU1_TRAIL_BYTE_OFFSET=     (BOCU1_MIN-BOCU1_TRAIL_CONTROLS_COUNT);

/* number of trail bytes */
var BOCU1_TRAIL_COUNT=       ((BOCU1_MAX_TRAIL-BOCU1_MIN+1)+BOCU1_TRAIL_CONTROLS_COUNT);

/*
 * number of positive and negative single-byte codes
 * (counting 0==BOCU1_MIDDLE among the positive ones)
 */
var BOCU1_SINGLE=            64;

/* number of lead bytes for positive and negative 2/3/4-byte sequences */
var BOCU1_LEAD_2=            43;
var BOCU1_LEAD_3=            3;
var BOCU1_LEAD_4=            1;

/* The difference value range for single-byters. */
var BOCU1_REACH_POS_1=   (BOCU1_SINGLE-1);
var BOCU1_REACH_NEG_1=   (-BOCU1_SINGLE);

/* The difference value range for double-byters. */
var BOCU1_REACH_POS_2=   (BOCU1_REACH_POS_1+BOCU1_LEAD_2*BOCU1_TRAIL_COUNT);
var BOCU1_REACH_NEG_2=   (BOCU1_REACH_NEG_1-BOCU1_LEAD_2*BOCU1_TRAIL_COUNT);

/* The difference value range for 3-byters. */
var BOCU1_REACH_POS_3=   (BOCU1_REACH_POS_2+BOCU1_LEAD_3*BOCU1_TRAIL_COUNT*BOCU1_TRAIL_COUNT);
var BOCU1_REACH_NEG_3=   (BOCU1_REACH_NEG_2-BOCU1_LEAD_3*BOCU1_TRAIL_COUNT*BOCU1_TRAIL_COUNT);

/* The lead byte start values. */
var BOCU1_START_POS_2=   (BOCU1_MIDDLE+BOCU1_REACH_POS_1+1);
var BOCU1_START_POS_3=   (BOCU1_START_POS_2+BOCU1_LEAD_2);
var BOCU1_START_POS_4=   (BOCU1_START_POS_3+BOCU1_LEAD_3);
     /* ==BOCU1_MAX_LEAD */

var BOCU1_START_NEG_2=   (BOCU1_MIDDLE+BOCU1_REACH_NEG_1);
var BOCU1_START_NEG_3=   (BOCU1_START_NEG_2-BOCU1_LEAD_2);
var BOCU1_START_NEG_4=   (BOCU1_START_NEG_3-BOCU1_LEAD_3);
     /* ==BOCU1_MIN+1 */

/* The length of a byte sequence, according to the lead byte (!=BOCU1_RESET). */
function BOCU1_LENGTH_FROM_LEAD (lead) {
	if (BOCU1_START_NEG_2 <= lead && lead<BOCU1_START_POS_2)
		return 1;
	else if (BOCU1_START_NEG_3 <= lead && lead<BOCU1_START_POS_3)
		return 2;
	else if (BOCU1_START_NEG_4 <= lead && lead<BOCU1_START_POS_4)
		return 3;
	else
		return 4;
}

/*
 * 12 commonly used C0 control codes (and space) are only used to encode
 * themselves directly,
 * which makes BOCU-1 MIME-usable and reasonably safe for
 * ASCII-oriented software.
 *
 * These controls are
 *  0   NUL
 *
 *  7   BEL
 *  8   BS
 *
 *  9   TAB
 *  a   LF
 *  b   VT
 *  c   FF
 *  d   CR
 *
 *  e   SO
 *  f   SI
 *
 * 1a   SUB
 * 1b   ESC
 *
 * The other 20 C0 controls are also encoded directly (to preserve order)
 * but are also used as trail bytes in difference encoding
 * (for better compression).
 */
function BOCU1_TRAIL_TO_BYTE(t) {
	if (t >= BOCU1_TRAIL_CONTROLS_COUNT)
		return t + BOCU1_TRAIL_BYTE_OFFSET;
	else
		return bocu1TrailToByte[t];
}

/*
 * Byte value map for control codes,
 * from external byte values 0x00..0x20
 * to trail byte values 0..19 (0..0x13) as used in the difference calculation.
 * External byte values that are illegal as trail bytes are mapped to -1.
 */
var bocu1ByteToTrail = [
/*  0     1     2     3     4     5     6     7    */
	-1,   0x00, 0x01, 0x02, 0x03, 0x04, 0x05, -1,

/*  8     9     a     b     c     d     e     f    */
	-1,   -1,   -1,   -1,   -1,   -1,   -1,   -1,

/*  10    11    12    13    14    15    16    17   */
	0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,

/*  18    19    1a    1b    1c    1d    1e    1f   */
	0x0e, 0x0f, -1,   -1,   0x10, 0x11, 0x12, 0x13,

/*  20   */
	-1
];

/*
 * Byte value map for control codes,
 * from trail byte values 0..19 (0..0x13) as used in the difference calculation
 * to external byte values 0x00..0x20.
 */
var bocu1TrailToByte = [
/*  0     1     2     3     4     5     6     7    */
	0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x10, 0x11,

/*  8     9     a     b     c     d     e     f    */
	0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,

/*  10    11    12    13   */
	0x1c, 0x1d, 0x1e, 0x1f
];

/* BOCU-1 implementation functions ------------------------------------------ */

/**
 * Compute the next "previous" value for differencing
 * from the current code point.
 *
 * @param c current code point, 0..0x10ffff
 * @return "previous code point" state value
 */
function bocu1Prev(c) {
	/* compute new prev */
	if(0x3040 <= c && c <= 0x309f) {
		/* Hiragana is not 128-aligned */
		return 0x3070;
	} else if (0x4e00 <= c && c <= 0x9fa5) {
		/* CJK Unihan */
		return 0x4e00 - BOCU1_REACH_NEG_2;
	} else if(0xac00 <= c && c <= 0xd7a3) {
		/* Korean Hangul */
		return Math.floor((0xd7a3 + 0xac00) / 2);
	} else {
		/* mostly small scripts */
		return (c & ~0x7f) + BOCU1_ASCII_PREV;
	}
}

/**
 * BOCU-1 encoder function.
 * bocu1.encode(str[, start][, end])
 * The start and end parameters default to 0 and str.length when undefined
 */
function bocu1Encode(str, start, end) {
	var prev, newPrev;
	var ptr;
	var dst = [];
	var c, wc;
	var m, divc, lead, count, dp;

	if (start === undefined)
		start = 0;
	if (end === undefined)
		end = str.length;

	ptr = start;
	prev = BOCU1_ASCII_PREV;
	while (ptr < end) {
		//decode surrogate pair
		c = str.charCodeAt(ptr++);
		if (c >= 0xd800 && c <= 0xdbff){
			wc = str.charCodeAt(ptr++);
			if (wc >= 0xdc00 && wc <= 0xdfff ){
				c = (((c - 0xd800) << 10) | (wc - 0xdc00)) + 0x10000;
			} else {
				ptr--;
			}
		}

		if (c <= 0x20){
			/*
			 * ISO C0 control & space:
			 * Encode directly for MIME compatibility,
			 * and reset state except for space, to not disrupt compression.
			 */
			if (c != 0x20){
				prev = BOCU1_ASCII_PREV;
			}
			dst[dst.length] = c;
			continue;
		}

		/*
		 * all other Unicode code points c==U+0021..U+10ffff
		 * are encoded with the difference c-prev
		 *
		 * a new prev is computed from c,
		 * placed in the middle of a 0x80-block (for most small scripts) or
		 * in the middle of the Unihan and Hangul blocks
		 * to statistically minimize the following difference
		 */
		newPrev = bocu1Prev(c);
		c -= prev;
		prev = newPrev;

		if (c >= BOCU1_REACH_NEG_1) {
			/* mostly positive differences, and single-byte negative ones */
			if (c <= BOCU1_REACH_POS_1) {
				/* single byte */
				dst[dst.length] = BOCU1_MIDDLE + c;
				continue;
			} else if (c <= BOCU1_REACH_POS_2) {
				/* two bytes */
				c -= BOCU1_REACH_POS_1 + 1;
				lead = BOCU1_START_POS_2;
				count = 1;
			} else if(c <= BOCU1_REACH_POS_3) {
				/* three bytes */
				c -= BOCU1_REACH_POS_2 + 1;
				lead = BOCU1_START_POS_3;
				count = 2;
			} else {
				/* four bytes */
				c -= BOCU1_REACH_POS_3 + 1;
				lead = BOCU1_START_POS_4;
				count = 3;
			}
		} else {
			/* two- and four-byte negative differences */
			if(c >= BOCU1_REACH_NEG_2) {
				/* two bytes */
				c -= BOCU1_REACH_NEG_1;
				lead = BOCU1_START_NEG_2;
				count = 1;
			} else if(c >= BOCU1_REACH_NEG_3) {
				/* three bytes */
				c -= BOCU1_REACH_NEG_2;
				lead = BOCU1_START_NEG_3;
				count = 2;
			} else {
				/* four bytes */
				c -= BOCU1_REACH_NEG_3;
				lead = BOCU1_START_NEG_4;
				count = 3;
			}
		}

		/* calculate trail bytes like digits in itoa() */
		dp = dst.length;
		do {
			divc = Math.floor(c / BOCU1_TRAIL_COUNT);
			m = c - divc * BOCU1_TRAIL_COUNT;
			c = divc;
			dst[dp + count] = BOCU1_TRAIL_TO_BYTE(m) & 0xff;
		} while(--count > 0);

		/* add lead byte */
		dst[dp] = (lead + c) & 0xff;
	}
	return Buffer.from(dst);
}

/**
 * BOCU-1 decoder function.
 * bocu1.decode(buffer[, start][, end])
 * The start and end parameters default to 0 and buffer.length when undefined
 */
function bocu1Decode(buffer, start, end) {
	var b, c, t;
	var prev, count;
	var ptr;
	var dst = [];

	if (start === undefined)
		start = 0;
	if (end === undefined)
		end = buffer.length;

	ptr = start;
	prev = BOCU1_ASCII_PREV;
	while (ptr < end) {
		/* lead byte */
		b = buffer[ptr++];
		if (b <= 0x20 ) {
			/*
			 * Direct-encoded C0 control code or space.
			 * Reset prev for C0 control codes but not for space.
			 */
			if (b != 0x20)
				prev = BOCU1_ASCII_PREV;
			dst[dst.length] = b;
			continue;
		}

		/*
		 * b is a difference lead byte.
		 *
		 * Return a code point directly from a single-byte difference.
		 *
		 * For multi-byte difference lead bytes, set the decoder state
		 * with the partial difference value from the lead byte and
		 * with the number of trail bytes.
		 *
		 * For four-byte differences, the signedness also affects the
		 * first trail byte, which has special handling farther below.
		 */
		if (b >= BOCU1_START_NEG_2 && b < BOCU1_START_POS_2) {
			/* single-byte difference */
			c = prev + (b - BOCU1_MIDDLE);
			prev = bocu1Prev(c);
		} else if (b == BOCU1_RESET){
			/* only reset the state, no code point */
			prev = BOCU1_ASCII_PREV;
			continue;	// nothing done
		} else {
			/* multi-byte difference */
			if (b >= BOCU1_START_NEG_2) {
				/* positive difference */
				if (b < BOCU1_START_POS_3) {
					/* two bytes */
					c = (b - BOCU1_START_POS_2) * BOCU1_TRAIL_COUNT + BOCU1_REACH_POS_1 + 1;
					count = 1;
				} else if(b < BOCU1_START_POS_4) {
					/* three bytes */
					c = (b - BOCU1_START_POS_3) * BOCU1_TRAIL_COUNT * BOCU1_TRAIL_COUNT + BOCU1_REACH_POS_2 + 1;
					count = 2;
				} else {
					/* four bytes */
					c = BOCU1_REACH_POS_3 + 1;
					count = 3;
				}
			} else {
				/* negative difference */
				if(b>=BOCU1_START_NEG_3) {
					/* two bytes */
					c = (b - BOCU1_START_NEG_2) * BOCU1_TRAIL_COUNT + BOCU1_REACH_NEG_1;
					count = 1;
				} else if(b>BOCU1_MIN) {
					/* three bytes */
					c = (b - BOCU1_START_NEG_3) * BOCU1_TRAIL_COUNT * BOCU1_TRAIL_COUNT + BOCU1_REACH_NEG_2;
					count = 2;
				} else {
					/* four bytes */
					c = -BOCU1_TRAIL_COUNT * BOCU1_TRAIL_COUNT * BOCU1_TRAIL_COUNT + BOCU1_REACH_NEG_3;
					count = 3;
				}
			}

			while (ptr < end) {
				/* trail byte(s) */
				b = buffer[ptr++];
				if (b <= 0x20) {
					/* skip some C0 controls and make the trail byte range contiguous */
					t = bocu1ByteToTrail[b];
					if (t < 0)
						throw "BOCU-1: illegal trail byte value";
				} /*else if(BOCU1_MAX_TRAIL < 0xff && b > BOCU1_MAX_TRAIL) {
					throw "BOCU-1: illegal trail byte value";
				}*/ else {
					t = b - BOCU1_TRAIL_BYTE_OFFSET;
				}

				/* add trail byte into difference and decrement count */
				if (count == 1) {
					/* final trail byte, deliver a code point */
					c = prev + c + t;
					if (0 <= c && c<=0x10ffff){
						/* valid code point result */
						prev = bocu1Prev(c);
						count = 0;
						break;
					} else {
						throw "BOCU-1: illegal code point result";
					}
				}

				/* intermediate trail byte */
				if(count == 2) {
					c += t * BOCU1_TRAIL_COUNT;
				} else /* count == 3 */ {
					c += t * BOCU1_TRAIL_COUNT * BOCU1_TRAIL_COUNT;
				}
				count--;
			}
			if (count !== 0)
				throw "BOCU-1: deficient trail byte(s)";
		}
		// encode surrogate pair
		if (c <= 0xffff){
			dst[dst.length] = c;
		} else {
			dst[dst.length] = (((c - 0x10000) >> 10) + 0xd800);
			dst[dst.length] = ((c & 0x3ff) + 0xdc00);
		}
	}
	return String.fromCharCode.apply(String, dst);
}

exports.encode = bocu1Encode;
exports.decode = bocu1Decode;
