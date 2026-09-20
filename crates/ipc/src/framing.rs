use std::error::Error;
use std::fmt::{self, Display, Formatter};

const HEADER_LEN: usize = size_of::<u32>();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrameError {
    InvalidMaximum,
    PayloadTooLarge { declared: u64, maximum: u32 },
    TruncatedFrame,
    DecoderFailed,
}

impl Display for FrameError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMaximum => write!(formatter, "frame maximum must be greater than zero"),
            Self::PayloadTooLarge { declared, maximum } => write!(
                formatter,
                "declared payload length {declared} exceeds maximum {maximum}"
            ),
            Self::TruncatedFrame => write!(formatter, "stream ended during a frame"),
            Self::DecoderFailed => {
                write!(formatter, "decoder cannot continue after protocol error")
            }
        }
    }
}

impl Error for FrameError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameEncoder {
    maximum: u32,
}

impl FrameEncoder {
    pub fn new(maximum: u32) -> Result<Self, FrameError> {
        if maximum == 0 {
            return Err(FrameError::InvalidMaximum);
        }
        Ok(Self { maximum })
    }

    pub fn encode(&self, payload: &[u8]) -> Result<Vec<u8>, FrameError> {
        let length = u32::try_from(payload.len()).map_err(|_| FrameError::PayloadTooLarge {
            declared: payload.len() as u64,
            maximum: self.maximum,
        })?;
        if length > self.maximum {
            return Err(FrameError::PayloadTooLarge {
                declared: u64::from(length),
                maximum: self.maximum,
            });
        }

        let mut frame = Vec::with_capacity(HEADER_LEN + payload.len());
        frame.extend_from_slice(&length.to_be_bytes());
        frame.extend_from_slice(payload);
        Ok(frame)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PushResult {
    pub consumed: usize,
    pub frame: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct FrameDecoder {
    maximum: u32,
    header: [u8; HEADER_LEN],
    header_used: usize,
    payload: Vec<u8>,
    expected: Option<usize>,
    failed: bool,
}

impl FrameDecoder {
    pub fn new(maximum: u32) -> Result<Self, FrameError> {
        if maximum == 0 {
            return Err(FrameError::InvalidMaximum);
        }
        Ok(Self {
            maximum,
            header: [0; HEADER_LEN],
            header_used: 0,
            payload: Vec::new(),
            expected: None,
            failed: false,
        })
    }

    /// Consumes at most one frame from `input`.
    ///
    /// The caller can pass the unconsumed suffix back to decode another frame.
    /// Payload allocation happens only after the complete header is checked.
    pub fn push(&mut self, input: &[u8]) -> Result<PushResult, FrameError> {
        if self.failed {
            return Err(FrameError::DecoderFailed);
        }

        let mut consumed = 0;
        if self.expected.is_none() {
            let take = (HEADER_LEN - self.header_used).min(input.len());
            self.header[self.header_used..self.header_used + take].copy_from_slice(&input[..take]);
            self.header_used += take;
            consumed += take;

            if self.header_used < HEADER_LEN {
                return Ok(PushResult {
                    consumed,
                    frame: None,
                });
            }

            let declared = u32::from_be_bytes(self.header);
            if declared > self.maximum {
                self.failed = true;
                return Err(FrameError::PayloadTooLarge {
                    declared: u64::from(declared),
                    maximum: self.maximum,
                });
            }
            let expected = declared as usize;
            self.payload = Vec::with_capacity(expected);
            self.expected = Some(expected);
            if expected == 0 {
                return Ok(self.complete_frame(consumed));
            }
        }

        let expected = self.expected.expect("expected length was set above");
        let remaining = expected - self.payload.len();
        let take = remaining.min(input.len() - consumed);
        self.payload
            .extend_from_slice(&input[consumed..consumed + take]);
        consumed += take;

        if self.payload.len() == expected {
            Ok(self.complete_frame(consumed))
        } else {
            Ok(PushResult {
                consumed,
                frame: None,
            })
        }
    }

    /// Confirms that the peer closed the stream only at a frame boundary.
    pub fn finish_stream(self) -> Result<(), FrameError> {
        if self.failed {
            return Err(FrameError::DecoderFailed);
        }
        if self.header_used != 0 || self.expected.is_some() {
            return Err(FrameError::TruncatedFrame);
        }
        Ok(())
    }

    fn complete_frame(&mut self, consumed: usize) -> PushResult {
        self.header_used = 0;
        self.expected = None;
        PushResult {
            consumed,
            frame: Some(std::mem::take(&mut self.payload)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_strict_u32_big_endian_framing() {
        let frame = FrameEncoder::new(256).unwrap().encode(b"abc").unwrap();
        assert_eq!(frame, [0, 0, 0, 3, b'a', b'b', b'c']);
    }

    #[test]
    fn reconstructs_every_byte_fragmentation() {
        let frame = FrameEncoder::new(256)
            .unwrap()
            .encode(b"fragmented")
            .unwrap();
        let mut decoder = FrameDecoder::new(256).unwrap();
        let mut decoded = None;
        for byte in frame {
            let result = decoder.push(&[byte]).unwrap();
            assert_eq!(result.consumed, 1);
            if result.frame.is_some() {
                assert!(decoded.is_none());
                decoded = result.frame;
            }
        }
        assert_eq!(decoded.as_deref(), Some(b"fragmented".as_slice()));
    }

    #[test]
    fn stops_after_one_frame_and_reports_consumption() {
        let encoder = FrameEncoder::new(256).unwrap();
        let mut bytes = encoder.encode(b"one").unwrap();
        bytes.extend(encoder.encode(b"two").unwrap());
        let mut decoder = FrameDecoder::new(256).unwrap();

        let first = decoder.push(&bytes).unwrap();
        assert_eq!(first.consumed, 7);
        assert_eq!(first.frame.as_deref(), Some(b"one".as_slice()));
        let second = decoder.push(&bytes[first.consumed..]).unwrap();
        assert_eq!(second.frame.as_deref(), Some(b"two".as_slice()));
    }

    #[test]
    fn rejects_oversize_header_before_allocating_payload() {
        let mut decoder = FrameDecoder::new(8).unwrap();
        let error = decoder.push(&9_u32.to_be_bytes()).unwrap_err();
        assert_eq!(
            error,
            FrameError::PayloadTooLarge {
                declared: 9,
                maximum: 8
            }
        );
        assert_eq!(decoder.payload.capacity(), 0);
        assert_eq!(decoder.push(&[]), Err(FrameError::DecoderFailed));
    }

    #[test]
    fn rejects_oversize_encode_and_invalid_limits() {
        assert_eq!(FrameEncoder::new(0), Err(FrameError::InvalidMaximum));
        assert_eq!(
            FrameDecoder::new(0).unwrap_err(),
            FrameError::InvalidMaximum
        );
        assert_eq!(
            FrameEncoder::new(2).unwrap().encode(b"abc"),
            Err(FrameError::PayloadTooLarge {
                declared: 3,
                maximum: 2
            })
        );
    }

    #[test]
    fn accepts_an_empty_payload() {
        let mut decoder = FrameDecoder::new(1).unwrap();
        let decoded = decoder.push(&[0, 0, 0, 0]).unwrap();
        assert_eq!(decoded.frame, Some(Vec::new()));
    }

    #[test]
    fn rejects_a_stream_truncated_in_header_or_payload() {
        let mut header = FrameDecoder::new(8).unwrap();
        header.push(&[0, 0]).unwrap();
        assert_eq!(header.finish_stream(), Err(FrameError::TruncatedFrame));

        let mut payload = FrameDecoder::new(8).unwrap();
        payload.push(&[0, 0, 0, 2, 1]).unwrap();
        assert_eq!(payload.finish_stream(), Err(FrameError::TruncatedFrame));
    }
}
