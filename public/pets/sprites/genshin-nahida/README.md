# Nahida Character Sprite

## Required File

Place the Nahida sprite sheet here:
- **Filename**: `sprite.png`
- **Source**: https://github.com/SeakMengs/WindowPet/blob/main/public/media/Nahida.png

## How to Get the Sprite

### Option 1: Direct Download
1. Go to: https://raw.githubusercontent.com/SeakMengs/WindowPet/main/public/media/Nahida.png
2. Right-click → Save As → Save as `sprite.png` in this directory

### Option 2: Clone Repository
```bash
# Clone WindowPet repository
git clone https://github.com/SeakMengs/WindowPet.git

# Copy the sprite
cp WindowPet/public/media/Nahida.png public/pets/sprites/genshin-nahida/sprite.png
```

## Sprite Format

- **Frame Size**: 128x128 pixels
- **Layout**: Grid-based sprite sheet
- **Animations**:
  - Line 1: Stand (1 frame)
  - Line 2: Walk (4 frames)
  - Line 3: Sit (1 frame)

## Testing

Once you've added the sprite file, you can test it by:

1. Starting the dev server: `npm run dev`
2. Opening browser console
3. Running: `localStorage.setItem('oakcloud-ui-preferences', JSON.stringify({petEnabled: true, selectedCharacter: 'genshin-nahida'}))`
4. Refreshing the page
5. You should see Nahida appear at the bottom-center of the dashboard!

## Troubleshooting

If the sprite doesn't load:
- Check browser console for errors
- Verify file is named exactly `sprite.png` (case-sensitive)
- Verify file is in correct location: `public/pets/sprites/genshin-nahida/sprite.png`
- Check Network tab to see if file is being requested
