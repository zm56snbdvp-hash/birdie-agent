use std::{env, fs, path::PathBuf};

const ICON_SIZE: usize = 32;

fn push_u16(output: &mut Vec<u8>, value: u16) {
  output.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
  output.extend_from_slice(&value.to_le_bytes());
}

fn push_i32(output: &mut Vec<u8>, value: i32) {
  output.extend_from_slice(&value.to_le_bytes());
}

fn icon_pixel(x: usize, y: usize) -> [u8; 4] {
  let dark_green = [44, 60, 6, 255];
  let gold = [85, 173, 213, 255];
  let cream = [222, 242, 247, 255];

  let dx = x as i32 - 16;
  let dy = y as i32 - 16;
  let radius_squared = dx * dx + dy * dy;
  let ring = (132..=190).contains(&radius_squared);

  let stem = (12..=14).contains(&x) && (8..=24).contains(&y);
  let upper_lobe = (14..=21).contains(&x)
    && (8..=16).contains(&y)
    && (((x as i32 - 16) * (x as i32 - 16)) + ((y as i32 - 12) * (y as i32 - 12)) <= 28);
  let lower_lobe = (14..=22).contains(&x)
    && (15..=24).contains(&y)
    && (((x as i32 - 16) * (x as i32 - 16)) + ((y as i32 - 20) * (y as i32 - 20)) <= 34);

  if stem || upper_lobe || lower_lobe {
    cream
  } else if ring {
    gold
  } else {
    dark_green
  }
}

fn build_icon() -> Vec<u8> {
  let xor_bytes = ICON_SIZE * ICON_SIZE * 4;
  let and_stride = ((ICON_SIZE + 31) / 32) * 4;
  let and_bytes = and_stride * ICON_SIZE;
  let bitmap_bytes = 40 + xor_bytes + and_bytes;

  let mut output = Vec::with_capacity(22 + bitmap_bytes);

  // ICONDIR
  push_u16(&mut output, 0);
  push_u16(&mut output, 1);
  push_u16(&mut output, 1);

  // ICONDIRENTRY
  output.push(ICON_SIZE as u8);
  output.push(ICON_SIZE as u8);
  output.push(0);
  output.push(0);
  push_u16(&mut output, 1);
  push_u16(&mut output, 32);
  push_u32(&mut output, bitmap_bytes as u32);
  push_u32(&mut output, 22);

  // BITMAPINFOHEADER. Height includes XOR and AND masks.
  push_u32(&mut output, 40);
  push_i32(&mut output, ICON_SIZE as i32);
  push_i32(&mut output, (ICON_SIZE * 2) as i32);
  push_u16(&mut output, 1);
  push_u16(&mut output, 32);
  push_u32(&mut output, 0);
  push_u32(&mut output, xor_bytes as u32);
  push_i32(&mut output, 0);
  push_i32(&mut output, 0);
  push_u32(&mut output, 0);
  push_u32(&mut output, 0);

  // DIB pixels are stored bottom-up as BGRA.
  for y in (0..ICON_SIZE).rev() {
    for x in 0..ICON_SIZE {
      output.extend_from_slice(&icon_pixel(x, y));
    }
  }

  // Opaque 1-bit AND mask, padded to DWORD rows.
  output.resize(output.len() + and_bytes, 0);
  output
}

fn ensure_windows_icon() {
  let manifest_dir = PathBuf::from(
    env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is required"),
  );
  let icon_path = manifest_dir.join("icons").join("icon.ico");
  fs::create_dir_all(icon_path.parent().expect("icon path requires parent"))
    .expect("could not create Tauri icon directory");
  fs::write(&icon_path, build_icon()).expect("could not generate Tauri Windows icon");
  println!("cargo:rerun-if-changed=build_support.rs");
}

fn main() {
  ensure_windows_icon();
  tauri_build::build();
}
