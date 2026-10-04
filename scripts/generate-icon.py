from PIL import Image, ImageDraw, ImageFont
import math
import os

def create_icon(size=512, tray_size=64):
    # Output directory: build/ at project root (one level up from scripts/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    build_dir = os.path.join(os.path.dirname(script_dir), 'build')
    os.makedirs(build_dir, exist_ok=True)
    # Create main icon with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Rounded square background with purple gradient
    padding = size * 0.05
    radius = size * 0.22
    
    # Create gradient background
    bg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    
    # Draw rounded rectangle with gradient effect using multiple layers
    for i in range(int(radius), int(size - radius)):
        t = (i - radius) / (size - 2 * radius)
        r = int(124 + (176 - 124) * t)
        g = int(140 + (112 - 140) * t)
        b = int(255 + (255 - 255) * t)
        bg_draw.line([(i, 0), (i, size)], fill=(r, g, b, 255))
    
    # Apply rounded rectangle mask
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([padding, padding, size - padding, size - padding], 
                                 radius=radius, fill=255)
    
    bg.putalpha(mask)
    img.paste(bg, (0, 0), bg)
    
    # Draw clipboard icon (white outline)
    clip_x = size * 0.28
    clip_y = size * 0.20
    clip_w = size * 0.44
    clip_h = size * 0.60
    clip_radius = size * 0.06
    stroke = max(2, int(size * 0.035))
    
    # Clipboard body
    draw.rounded_rectangle(
        [clip_x, clip_y + stroke, clip_x + clip_w, clip_y + clip_h],
        radius=clip_radius,
        outline=(255, 255, 255, 255),
        width=stroke,
        fill=(124, 140, 255, 100)
    )
    
    # Clipboard top clip
    clip_top_h = size * 0.12
    clip_top_w = size * 0.20
    clip_top_x = clip_x + clip_w / 2 - clip_top_w / 2
    clip_top_y = clip_y - stroke
    
    draw.rounded_rectangle(
        [clip_top_x, clip_top_y, clip_top_x + clip_top_w, clip_top_y + clip_top_h + stroke],
        radius=size * 0.02,
        fill=(255, 255, 255, 255),
    )
    
    # Hole in clip
    hole_r = size * 0.025
    draw.ellipse(
        [clip_top_x + clip_top_w / 2 - hole_r, clip_top_y + clip_top_h / 2 - hole_r,
         clip_top_x + clip_top_w / 2 + hole_r, clip_top_y + clip_top_h / 2 + hole_r],
        fill=(124, 140, 255, 255)
    )
    
    # Paperclip shape
    pc_x = clip_x + clip_w * 0.30
    pc_y = clip_y + clip_h * 0.20
    pc_w = clip_w * 0.28
    pc_h = clip_h * 0.50
    pc_stroke = max(2, int(size * 0.03))
    
    # Draw paperclip (U shape)
    # Left side
    draw.line(
        [(pc_x, pc_y + pc_h * 0.25), (pc_x, pc_y + pc_h * 0.85)],
        fill=(255, 255, 255, 255),
        width=pc_stroke
    )
    # Right side (shorter, inner)
    draw.line(
        [(pc_x + pc_w, pc_y + pc_h * 0.15), (pc_x + pc_w, pc_y + pc_h * 0.75)],
        fill=(255, 255, 255, 255),
        width=pc_stroke
    )
    # Top arc
    draw.arc(
        [pc_x, pc_y, pc_x + pc_w, pc_y + pc_h * 0.35],
        start=180, end=0,
        fill=(255, 255, 255, 255),
        width=pc_stroke
    )
    # Bottom arc
    draw.arc(
        [pc_x, pc_y + pc_h * 0.60, pc_x + pc_w, pc_y + pc_h],
        start=0, end=180,
        fill=(255, 255, 255, 255),
        width=pc_stroke
    )
    
    # Checkmark
    chk_x = clip_x + clip_w * 0.55
    chk_y = clip_y + clip_h * 0.65
    chk_size = clip_w * 0.25
    chk_stroke = max(2, int(size * 0.035))
    
    draw.line(
        [(chk_x, chk_y + chk_size * 0.4),
         (chk_x + chk_size * 0.3, chk_y + chk_size * 0.7),
         (chk_x + chk_size, chk_y)],
        fill=(255, 255, 255, 255),
        width=chk_stroke
    )
    
    # Save main icon
    icon_path = os.path.join(build_dir, 'icon.png')
    img.save(icon_path, 'PNG')
    
    # Create tray icon (smaller, high contrast)
    tray_img = img.resize((tray_size, tray_size), Image.LANCZOS)
    tray_path = os.path.join(build_dir, 'tray.png')
    tray_img.save(tray_path, 'PNG')
    
    print(f"Icons created: {icon_path} ({size}x{size}), {tray_path} ({tray_size}x{tray_size})")

if __name__ == '__main__':
    create_icon(512, 64)
