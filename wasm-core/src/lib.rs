use gif::{Encoder as RawGifEncoder, Frame as RawGifFrame, Repeat as RawGifRepeat};
use image::codecs::gif::GifDecoder;
use image::{AnimationDecoder, DynamicImage, GenericImageView};
use js_sys::{Object, Reflect, Uint8Array, Uint16Array};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

const ASCII_CHARS: &[u8] = b" .,:;+*?%#@";
const MANGA_CHARS: &[u8] = b" .`'^,\":;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const NEON_CHARS: &[u8] = b" .:-=+*#%@";
const TERMINAL_CHARS: &[u8] = b" .`^,:;Il!i|/\\()[]{}<>+*xX#%@";
const NEWSPAPER_CHARS: &[u8] = b" .,:;=!*#%@";
const MATRIX_CHARS: &[u8] = b" 01/\\|[]{}<>~+=*#%@";
const MAX_INPUT_BYTES: usize = 20 * 1024 * 1024;
const MAX_TARGET_WIDTH: u32 = 300;
const MAX_GIF_FRAMES: usize = 600;
const MAX_EXPORT_PIXELS_PER_FRAME: u64 = 8_000_000;
const FRAME_DELAY_MS: u16 = 100;

#[derive(Clone, Copy)]
enum RenderPreset {
    Classic,
    Manga,
    Neon,
    Terminal,
    Newspaper,
    Matrix,
}

impl RenderPreset {
    fn from_str(value: &str) -> Self {
        match value {
            "manga" => Self::Manga,
            "neon" => Self::Neon,
            "terminal" => Self::Terminal,
            "newspaper" => Self::Newspaper,
            "matrix" => Self::Matrix,
            _ => Self::Classic,
        }
    }

    fn chars(self) -> &'static [u8] {
        match self {
            Self::Classic => ASCII_CHARS,
            Self::Manga => MANGA_CHARS,
            Self::Neon => NEON_CHARS,
            Self::Terminal => TERMINAL_CHARS,
            Self::Newspaper => NEWSPAPER_CHARS,
            Self::Matrix => MATRIX_CHARS,
        }
    }

    fn color_boost(self) -> f32 {
        match self {
            Self::Classic => 1.0,
            Self::Manga => 0.95,
            Self::Neon => 1.25,
            Self::Terminal => 0.9,
            Self::Newspaper => 0.85,
            Self::Matrix => 0.78,
        }
    }

    fn contrast(self) -> f32 {
        match self {
            Self::Classic => 1.0,
            Self::Manga => 1.12,
            Self::Neon => 1.2,
            Self::Terminal => 1.08,
            Self::Newspaper => 1.18,
            Self::Matrix => 1.25,
        }
    }
}

fn ensure_target_width(target_width: u32) -> Result<(), JsError> {
    if target_width == 0 || target_width > MAX_TARGET_WIDTH {
        return Err(JsError::new("Largeur ASCII hors limites"));
    }
    Ok(())
}

fn ensure_input_size(image_bytes: &[u8]) -> Result<(), JsError> {
    if image_bytes.is_empty() || image_bytes.len() > MAX_INPUT_BYTES {
        return Err(JsError::new("Fichier vide ou trop volumineux"));
    }
    Ok(())
}

fn compute_target_height(
    source_width: u32,
    source_height: u32,
    target_width: u32,
) -> Result<u32, JsError> {
    if source_width == 0 || source_height == 0 {
        return Err(JsError::new("Dimensions source invalides"));
    }
    let aspect_ratio = (source_height as f32 / source_width as f32) * 0.55;
    Ok(((target_width as f32 * aspect_ratio).round() as u32).max(1))
}

fn ascii_byte_from_rgb(red: u8, green: u8, blue: u8) -> u8 {
    ascii_byte_from_rgb_with_chars(red, green, blue, ASCII_CHARS, 1.0)
}

fn ascii_byte_from_rgb_with_chars(
    red: u8,
    green: u8,
    blue: u8,
    chars: &[u8],
    contrast: f32,
) -> u8 {
    let luminance = (0.299 * red as f32 + 0.587 * green as f32 + 0.114 * blue as f32) / 255.0;
    let mut adjusted = (luminance - 0.5) * contrast + 0.5;
    adjusted = adjusted.clamp(0.0, 1.0);
    let idx = (adjusted * (chars.len() - 1) as f32) as usize;
    chars[idx.min(chars.len() - 1)]
}

fn boost_rgb(red: u8, green: u8, blue: u8, boost: f32) -> (u8, u8, u8) {
    let clamp = |value: f32| value.clamp(0.0, 255.0) as u8;
    (
        clamp(red as f32 * boost),
        clamp(green as f32 * boost),
        clamp(blue as f32 * boost),
    )
}

fn checked_ascii_cells_len(width: u32, height: u32) -> Result<usize, JsError> {
    (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| JsError::new("Overflow grille ASCII"))
}

fn checked_rgba_frame_len(width: u32, height: u32) -> Result<usize, JsError> {
    let frame_pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| JsError::new("Overflow dimensions"))?;
    frame_pixels
        .checked_mul(4)
        .ok_or_else(|| JsError::new("Overflow buffer RGBA"))
}

fn ensure_export_dimensions(width: u32, height: u32) -> Result<(u16, u16), JsError> {
    let pixels_per_frame = (width as u64) * (height as u64);
    if pixels_per_frame == 0 || pixels_per_frame > MAX_EXPORT_PIXELS_PER_FRAME {
        return Err(JsError::new("Dimensions export GIF hors limites"));
    }
    let w = u16::try_from(width).map_err(|_| JsError::new("Largeur GIF > 65535"))?;
    let h = u16::try_from(height).map_err(|_| JsError::new("Hauteur GIF > 65535"))?;
    Ok((w, h))
}

fn delay_ms_to_cs(delay_ms: u32) -> u16 {
    let cs = ((delay_ms + 5) / 10).max(1);
    cs.min(u16::MAX as u32) as u16
}

#[wasm_bindgen]
pub fn process_gif_to_ascii_color(
    image_bytes: &[u8],
    target_width: u32,
    preset_name: &str,
) -> Result<JsValue, JsError> {
    ensure_input_size(image_bytes)?;
    ensure_target_width(target_width)?;
    let preset = RenderPreset::from_str(preset_name);
    let charset = preset.chars();

    if image_bytes.len() < 6
        || !(image_bytes.starts_with(b"GIF87a") || image_bytes.starts_with(b"GIF89a"))
    {
        return Err(JsError::new("Le fichier n'est pas un GIF valide"));
    }

    let cursor = Cursor::new(image_bytes);

    let decoder =
        GifDecoder::new(cursor).map_err(|e| JsError::new(&format!("Erreur init GIF: {e}")))?;

    let frames = decoder
        .into_frames()
        .collect_frames()
        .map_err(|e| JsError::new(&format!("Erreur frames: {}", e)))?;

    if frames.is_empty() {
        return Err(JsError::new("GIF sans frame exploitable"));
    }
    if frames.len() > MAX_GIF_FRAMES {
        return Err(JsError::new("GIF trop long (trop de frames)"));
    }

    let first_buffer = frames[0].buffer();
    let (first_w, first_h) = first_buffer.dimensions();
    let target_height = compute_target_height(first_w, first_h, target_width)?;
    let cells_per_frame = checked_ascii_cells_len(target_width, target_height)?;
    let total_cells = cells_per_frame
        .checked_mul(frames.len())
        .ok_or_else(|| JsError::new("Overflow buffer chars"))?;
    let total_rgb = total_cells
        .checked_mul(3)
        .ok_or_else(|| JsError::new("Overflow buffer rgb"))?;

    let mut chars = Vec::with_capacity(total_cells);
    let mut rgb = Vec::with_capacity(total_rgb);
    let mut delays_ms = Vec::with_capacity(frames.len());

    for frame in frames {
        let delay = frame.delay();
        let (delay_num, delay_den) = delay.numer_denom_ms();
        let denom = delay_den.max(1);
        let rounded_delay_ms = ((delay_num + (denom / 2)) / denom)
            .max(1)
            .min(u16::MAX as u32) as u16;
        delays_ms.push(rounded_delay_ms);

        let dynamic_img = DynamicImage::ImageRgba8(frame.into_buffer());
        let resized_img = dynamic_img.resize_exact(
            target_width,
            target_height,
            image::imageops::FilterType::Nearest,
        );

        for y in 0..target_height {
            for x in 0..target_width {
                let [red, green, blue, alpha] = resized_img.get_pixel(x, y).0;
                if alpha < 128 {
                    chars.push(b' ');
                    rgb.extend_from_slice(&[0, 0, 0]);
                } else {
                    let (boosted_red, boosted_green, boosted_blue) =
                        boost_rgb(red, green, blue, preset.color_boost());
                    chars.push(ascii_byte_from_rgb_with_chars(
                        boosted_red,
                        boosted_green,
                        boosted_blue,
                        charset,
                        preset.contrast(),
                    ));
                    rgb.extend_from_slice(&[boosted_red, boosted_green, boosted_blue]);
                }
            }
        }
    }

    let result = Object::new();
    Reflect::set(
        &result,
        &JsValue::from_str("width"),
        &JsValue::from_f64(target_width as f64),
    )
    .map_err(|_| JsError::new("Erreur création payload.width"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("height"),
        &JsValue::from_f64(target_height as f64),
    )
    .map_err(|_| JsError::new("Erreur création payload.height"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("frameCount"),
        &JsValue::from_f64(delays_ms.len() as f64),
    )
    .map_err(|_| JsError::new("Erreur création payload.frameCount"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("chars"),
        &Uint8Array::from(chars.as_slice()).into(),
    )
    .map_err(|_| JsError::new("Erreur création payload.chars"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("rgb"),
        &Uint8Array::from(rgb.as_slice()).into(),
    )
    .map_err(|_| JsError::new("Erreur création payload.rgb"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("delaysMs"),
        &Uint16Array::from(delays_ms.as_slice()).into(),
    )
    .map_err(|_| JsError::new("Erreur création payload.delaysMs"))?;

    Ok(result.into())
}

#[wasm_bindgen]
pub fn process_image_to_ascii(image_bytes: &[u8], target_width: u32) -> Result<String, JsError> {
    process_image_to_ascii_with_preset(image_bytes, target_width, "classic")
}

#[wasm_bindgen]
pub fn process_image_to_ascii_with_preset(
    image_bytes: &[u8],
    target_width: u32,
    preset_name: &str,
) -> Result<String, JsError> {
    ensure_input_size(image_bytes)?;
    ensure_target_width(target_width)?;
    let preset = RenderPreset::from_str(preset_name);
    let charset = preset.chars();

    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsError::new(&format!("Erreur image: {}", e)))?;

    let (width, height) = img.dimensions();
    let target_height = compute_target_height(width, height, target_width)?;

    let resized_img = img.resize_exact(
        target_width,
        target_height,
        image::imageops::FilterType::Nearest,
    );
    let mut ascii_art = String::with_capacity(((target_width + 1) * target_height) as usize);

    for y in 0..target_height {
        for x in 0..target_width {
            let pixel = resized_img.get_pixel(x, y);
            let [red, green, blue, transparency] = pixel.0;

            if transparency < 128 {
                ascii_art.push(' ');
            } else {
                ascii_art.push(
                    ascii_byte_from_rgb_with_chars(
                        red,
                        green,
                        blue,
                        charset,
                        preset.contrast(),
                    ) as char,
                );
            }
        }
        ascii_art.push('\n');
    }

    Ok(ascii_art)
}

#[wasm_bindgen]
pub fn process_rgba_frame_to_ascii_color_with_preset(
    rgba_pixels: &[u8],
    source_width: u32,
    source_height: u32,
    target_width: u32,
    preset_name: &str,
) -> Result<JsValue, JsError> {
    ensure_input_size(rgba_pixels)?;
    ensure_target_width(target_width)?;
    if source_width == 0 || source_height == 0 {
        return Err(JsError::new("Dimensions source invalides"));
    }

    let expected_len = (source_width as usize)
        .checked_mul(source_height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| JsError::new("Overflow buffer RGBA"))?;
    if rgba_pixels.len() != expected_len {
        return Err(JsError::new("Taille RGBA invalide"));
    }

    let preset = RenderPreset::from_str(preset_name);
    let charset = preset.chars();
    let target_height = compute_target_height(source_width, source_height, target_width)?;
    let cells = checked_ascii_cells_len(target_width, target_height)?;

    let mut chars = Vec::with_capacity(cells);
    let mut rgb = Vec::with_capacity(cells * 3);

    for y in 0..target_height {
        let sample_y = ((y as f32 / target_height as f32) * source_height as f32)
            .floor()
            .min((source_height - 1) as f32) as u32;

        for x in 0..target_width {
            let sample_x = ((x as f32 / target_width as f32) * source_width as f32)
                .floor()
                .min((source_width - 1) as f32) as u32;
            let index = ((sample_y * source_width + sample_x) * 4) as usize;
            let red = rgba_pixels[index];
            let green = rgba_pixels[index + 1];
            let blue = rgba_pixels[index + 2];
            let alpha = rgba_pixels[index + 3];

            if alpha < 128 {
                chars.push(b' ');
                rgb.extend_from_slice(&[0, 0, 0]);
            } else {
                let (boosted_red, boosted_green, boosted_blue) =
                    boost_rgb(red, green, blue, preset.color_boost());
                chars.push(ascii_byte_from_rgb_with_chars(
                    boosted_red,
                    boosted_green,
                    boosted_blue,
                    charset,
                    preset.contrast(),
                ));
                rgb.extend_from_slice(&[boosted_red, boosted_green, boosted_blue]);
            }
        }
    }

    let result = Object::new();
    Reflect::set(
        &result,
        &JsValue::from_str("width"),
        &JsValue::from_f64(target_width as f64),
    )
    .map_err(|_| JsError::new("Erreur création payload.width"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("height"),
        &JsValue::from_f64(target_height as f64),
    )
    .map_err(|_| JsError::new("Erreur création payload.height"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("frameCount"),
        &JsValue::from_f64(1.0),
    )
    .map_err(|_| JsError::new("Erreur création payload.frameCount"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("chars"),
        &Uint8Array::from(chars.as_slice()).into(),
    )
    .map_err(|_| JsError::new("Erreur création payload.chars"))?;
    Reflect::set(
        &result,
        &JsValue::from_str("rgb"),
        &Uint8Array::from(rgb.as_slice()).into(),
    )
    .map_err(|_| JsError::new("Erreur création payload.rgb"))?;
    let delays_ms = vec![FRAME_DELAY_MS as u16];
    Reflect::set(
        &result,
        &JsValue::from_str("delaysMs"),
        &Uint16Array::from(delays_ms.as_slice()).into(),
    )
    .map_err(|_| JsError::new("Erreur création payload.delaysMs"))?;

    Ok(result.into())
}

#[wasm_bindgen]
pub struct GifEncodeSession {
    encoder: Option<RawGifEncoder<Cursor<Vec<u8>>>>,
    width: u16,
    height: u16,
}

#[wasm_bindgen]
impl GifEncodeSession {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<GifEncodeSession, JsError> {
        let (w, h) = ensure_export_dimensions(width, height)?;
        let mut encoder = RawGifEncoder::new(Cursor::new(Vec::new()), w, h, &[])
            .map_err(|e| JsError::new(&format!("Erreur init GIF: {e}")))?;
        encoder
            .set_repeat(RawGifRepeat::Infinite)
            .map_err(|e| JsError::new(&format!("Erreur boucle GIF: {e}")))?;
        Ok(GifEncodeSession {
            encoder: Some(encoder),
            width: w,
            height: h,
        })
    }

    pub fn push_frame(&mut self, rgba_pixels: &[u8], delay_cs: u16) -> Result<(), JsError> {
        let expected_len = checked_rgba_frame_len(self.width as u32, self.height as u32)?;
        if rgba_pixels.len() != expected_len {
            return Err(JsError::new("Taille frame RGBA invalide"));
        }

        let mut owned_pixels = rgba_pixels.to_vec();
        let mut frame =
            RawGifFrame::from_rgba_speed(self.width, self.height, &mut owned_pixels, 10);
        frame.delay = delay_cs.max(1);

        self.encoder
            .as_mut()
            .ok_or_else(|| JsError::new("Session encodeur fermée"))?
            .write_frame(&frame)
            .map_err(|e| JsError::new(&format!("Erreur encodage frame: {e}")))
    }

    pub fn finish(mut self) -> Result<js_sys::Uint8Array, JsError> {
        let encoder = self
            .encoder
            .take()
            .ok_or_else(|| JsError::new("Session encodeur déjà finalisée"))?;

        let cursor = encoder
            .into_inner()
            .map_err(|e| JsError::new(&format!("Erreur finalisation GIF: {e}")))?;
        let bytes = cursor.into_inner();
        Ok(js_sys::Uint8Array::from(bytes.as_slice()))
    }
}

#[wasm_bindgen]
pub fn encode_gif_from_pixels(
    flat_pixels: &[u8],
    width: u32,
    height: u32,
    frame_count: u32,
    delay_ms: u32,
) -> Result<js_sys::Uint8Array, JsError> {
    if frame_count == 0 || frame_count as usize > MAX_GIF_FRAMES {
        return Err(JsError::new("Nombre de frames export invalide"));
    }

    let (w, h) = ensure_export_dimensions(width, height)?;
    let frame_size = checked_rgba_frame_len(width, height)?;
    let expected_len = frame_size
        .checked_mul(frame_count as usize)
        .ok_or_else(|| JsError::new("Overflow taille export"))?;

    if flat_pixels.len() != expected_len {
        return Err(JsError::new("Taille du buffer plat invalide"));
    }

    let mut encoder = RawGifEncoder::new(Cursor::new(Vec::new()), w, h, &[])
        .map_err(|e| JsError::new(&format!("Erreur init GIF: {e}")))?;
    encoder
        .set_repeat(RawGifRepeat::Infinite)
        .map_err(|e| JsError::new(&format!("Erreur boucle GIF: {e}")))?;

    let delay_cs = delay_ms_to_cs(delay_ms);

    for i in 0..frame_count as usize {
        let start = i * frame_size;
        let end = start + frame_size;
        let mut owned_pixels = flat_pixels[start..end].to_vec();
        let mut frame = RawGifFrame::from_rgba_speed(w, h, &mut owned_pixels, 10);
        frame.delay = delay_cs;
        encoder
            .write_frame(&frame)
            .map_err(|e| JsError::new(&format!("Erreur encodage frame: {e}")))?;
    }

    let cursor = encoder
        .into_inner()
        .map_err(|e| JsError::new(&format!("Erreur finalisation GIF: {e}")))?;
    let bytes = cursor.into_inner();
    Ok(js_sys::Uint8Array::from(bytes.as_slice()))
}
