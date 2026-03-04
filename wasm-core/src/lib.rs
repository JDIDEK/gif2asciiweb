use wasm_bindgen::prelude::*;
use image::{DynamicImage, GenericImageView, AnimationDecoder};
use image::codecs::gif::GifDecoder;
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
    let cursor = Cursor::new(image_bytes);
    
    let decoder = GifDecoder::new(cursor)
        .map_err(|e| JsError::new(&format!("Erreur décodeur GIF: {}", e)))?;

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