use wasm_bindgen::prelude::*;
use image::{DynamicImage, GenericImageView, AnimationDecoder, RgbaImage, Frame, Delay}; 
use image::codecs::gif::{GifEncoder, GifDecoder, Repeat};
use std::io::Cursor;
use serde::{Serialize, Deserialize};

const ASCII_CHARS: &[u8] = b" .,:;+*?%#@";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AsciiPixel {
    pub character: char,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

#[wasm_bindgen]
pub fn process_gif_to_ascii_color(image_bytes: &[u8], target_width: u32) -> Result<JsValue, JsError> {
    if image_bytes.len() < 6 || !(&image_bytes[0..3] == b"GIF") {
        return Err(JsError::new("Le fichier n'est pas un GIF valide (Header manquant)"));
    }

    let cursor = Cursor::new(image_bytes);
    
    let decoder = GifDecoder::new(cursor)
        .map_err(|_| JsError::new("Impossible de décoder le GIF. Vérifiez le format."))?;

    let frames = decoder.into_frames()
        .collect_frames()
        .map_err(|e| JsError::new(&format!("Erreur frames: {}", e)))?;

    let mut all_frames: Vec<Vec<AsciiPixel>> = Vec::new();

    for frame in frames {
        let img_buffer = frame.buffer();
        let dynamic_img = DynamicImage::ImageRgba8(img_buffer.clone());
        let (width, height) = dynamic_img.dimensions();
        
        let aspect_ratio = (height as f32 / width as f32) * 0.55; 
        let target_height = (target_width as f32 * aspect_ratio) as u32;

        let resized_img = dynamic_img.resize_exact(
            target_width, 
            target_height, 
            image::imageops::FilterType::Nearest
        );

        let mut ascii_frame: Vec<AsciiPixel> = Vec::with_capacity((target_width * target_height) as usize);
        
        for y in 0..target_height {
            for x in 0..target_width {
                let pixel = resized_img.get_pixel(x, y);
                let [red, green, blue, transparency] = pixel.0;

                if transparency < 128 {
                    ascii_frame.push(AsciiPixel {
                        character: ' ',
                        red: 0, green: 0, blue: 0,
                    });
                } else {
                    let luminance = 0.299 * red as f32 + 0.587 * green as f32 + 0.114 * blue as f32;
                    let char_index = ((luminance / 255.0) * (ASCII_CHARS.len() - 1) as f32) as usize;
                    
                    ascii_frame.push(AsciiPixel {
                        character: ASCII_CHARS[char_index] as char,
                        red, 
                        green, 
                        blue,
                    });
                }
            }
        }
        all_frames.push(ascii_frame);
    }

    Ok(serde_wasm_bindgen::to_value(&all_frames)?)
}

#[wasm_bindgen]
pub fn process_image_to_ascii(image_bytes: &[u8], target_width: u32) -> Result<String, JsError> {
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsError::new(&format!("Erreur image: {}", e)))?;
    
    let (width, height) = img.dimensions();
    let aspect_ratio = (height as f32 / width as f32) * 0.55;
    let target_height = (target_width as f32 * aspect_ratio) as u32;

    let resized_img = img.resize_exact(target_width, target_height, image::imageops::FilterType::Nearest);
    let mut ascii_art = String::new();

    for y in 0..target_height {
        for x in 0..target_width {
            let pixel = resized_img.get_pixel(x, y);
            let [red, green, blue, transparency] = pixel.0;

            if transparency < 128 {
                ascii_art.push(' ');
            } else {
                let luminance = 0.299 * red as f32 + 0.587 * green as f32 + 0.114 * blue as f32;
                let char_index = ((luminance / 255.0) * (ASCII_CHARS.len() - 1) as f32) as usize;
                ascii_art.push(ASCII_CHARS[char_index] as char);
            }
        }
        ascii_art.push('\n');
    }

    Ok(ascii_art)
}

#[wasm_bindgen]
pub fn encode_gif_from_pixels(
    flat_pixels: &[u8],
    width: u32,
    height: u32,
    frame_count: u32,
    delay_ms: u32,
) -> Result<js_sys::Uint8Array, JsError> {
    let mut buffer = Vec::new();
    
    {
        let mut encoder = GifEncoder::new(&mut buffer);
        encoder.set_repeat(Repeat::Infinite)
            .map_err(|e| JsError::new(&format!("Erreur boucle GIF: {}", e)))?;

        let frame_size = (width * height * 4) as usize;

        for i in 0..frame_count {
            let start = (i as usize) * frame_size;
            let end = start + frame_size;
            
            if end > flat_pixels.len() {
                return Err(JsError::new("Buffer overflow: pas assez de pixels reçus"));
            }

            let frame_pixels = &flat_pixels[start..end];
            
            let img = RgbaImage::from_raw(width, height, frame_pixels.to_vec())
                .ok_or_else(|| JsError::new("Erreur création image RGBA"))?;

            let delay = Delay::from_numer_denom_ms(delay_ms, 1);
            let frame = Frame::from_parts(img, 0, 0, delay);
            
            encoder.encode_frame(frame)
                .map_err(|e| JsError::new(&format!("Erreur encodage frame: {}", e)))?;
        }
    }
    
    Ok(js_sys::Uint8Array::from(&buffer[..]))
}