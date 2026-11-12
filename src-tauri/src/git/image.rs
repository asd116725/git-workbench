use base64::{Engine, engine::general_purpose::STANDARD};
use std::path::Path;

/// 固定支持的图片 MIME，仓库文件只作为 WebView 的 img 资源展示。
#[derive(Clone, Copy)]
pub(super) enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
    Bmp,
    Ico,
    Svg,
}

impl ImageFormat {
    pub(super) fn from_path(path: &str) -> Option<Self> {
        Some(
            match Path::new(path)
                .extension()?
                .to_str()?
                .to_ascii_lowercase()
                .as_str()
            {
                "png" => Self::Png,
                "jpg" | "jpeg" => Self::Jpeg,
                "gif" => Self::Gif,
                "webp" => Self::Webp,
                "bmp" => Self::Bmp,
                "ico" => Self::Ico,
                "svg" => Self::Svg,
                _ => return None,
            },
        )
    }

    /// 扩展名用于选格式，文件头确认栅格内容，避免将 LFS 指针或普通文本当作图片。
    pub(super) fn data_url(self, bytes: &[u8]) -> Option<String> {
        let mime = match self {
            Self::Png if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "image/png",
            Self::Jpeg if bytes.starts_with(b"\xff\xd8\xff") => "image/jpeg",
            Self::Gif if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => {
                "image/gif"
            }
            Self::Webp if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
                "image/webp"
            }
            Self::Bmp if bytes.starts_with(b"BM") => "image/bmp",
            Self::Ico if bytes.starts_with(b"\0\0\x01\0") => "image/x-icon",
            Self::Svg if std::str::from_utf8(bytes).ok()?.contains("<svg") => "image/svg+xml",
            _ => return None,
        };
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }
}
