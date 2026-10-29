# Pet Mascot Debugging Guide

## Quick Checklist

### 1. Check if Pet is Enabled
Open browser console (F12) and run:
```javascript
JSON.parse(localStorage.getItem('oakcloud-ui-preferences'))
```

You should see:
```json
{
  "petEnabled": true,
  "selectedCharacter": "genshin-nahida",
  "petSettings": {
    "scale": 1,
    "speed": 1,
    "soundEnabled": false
  }
}
```

If `petEnabled` is `false` or the object is missing, run:
```javascript
localStorage.setItem('oakcloud-ui-preferences', JSON.stringify({
  petEnabled: true,
  selectedCharacter: 'genshin-nahida',
  petSettings: {scale: 1.0, speed: 1.0, soundEnabled: false},
  sidebarCollapsed: false,
  theme: 'light'
}))
```
Then refresh the page.

### 2. Check Console for Errors
Look for errors in browser console (F12 → Console tab):
- ❌ `Failed to load file: sprite` - Sprite file not found
- ❌ `Character not found: genshin-nahida` - Character config issue
- ❌ `Uncaught TypeError` - JavaScript error

### 3. Verify Sprite File Exists
Check Network tab (F12 → Network):
- Filter by "sprite"
- Refresh page
- Look for `sprite.png` request
- Status should be `200 OK` (not 404)
- Size should be ~4.8 MB

Or check file system:
```bash
ls -lh public/pets/sprites/genshin-nahida/sprite.png
```
Should show: `4.8M`

### 4. Check if Phaser Canvas Exists
Run in console:
```javascript
document.querySelector('.phaser-canvas-container')
```

Should return a `<div>` element. If `null`, the PetMascotProvider isn't rendering.

### 5. Check if You're on a Dashboard Page
The pet only appears on **dashboard pages** (pages inside `(dashboard)` route), not on:
- `/login`
- `/forgot-password`
- `/reset-password`

Make sure you're navigated to a page like:
- `/` (home)
- `/companies`
- `/contacts`
- `/processing`

### 6. Check for Reduced Motion
Run in console:
```javascript
window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

If `true`, the pet is disabled for accessibility. To test anyway:
```javascript
// Override (for testing only)
Object.defineProperty(window.matchMedia('(prefers-reduced-motion: reduce)'), 'matches', {
  value: false,
  writable: true
});
```
Then refresh.

## Common Issues & Solutions

### Issue: "I enabled it but nothing appears"

**Solution 1: Check you're logged in**
- Pet only shows on dashboard pages
- Make sure you're not on `/login`

**Solution 2: Hard refresh**
```
Ctrl + Shift + R (or Cmd + Shift + R on Mac)
```

**Solution 3: Clear all site data**
- F12 → Application tab → Storage → Clear site data
- Then set localStorage again
- Refresh

### Issue: "Console says 'Failed to load file: sprite'"

**Solution: Sprite file is missing or in wrong location**

```bash
# Copy Nahida sprite to correct location
cp public/pets/sprites/Nahida.png public/pets/sprites/genshin-nahida/sprite.png

# Verify it exists
ls -lh public/pets/sprites/genshin-nahida/sprite.png
```

### Issue: "Canvas exists but no sprite visible"

**Solution: Check Phaser initialization**

In console:
```javascript
// Check if Phaser loaded
typeof Phaser
```
Should return `"object"` or `"function"`, not `"undefined"`.

### Issue: "Sprite appears as blank square"

**Possible causes:**
1. Sprite file is corrupt
2. Sprite format is wrong
3. Animation config is incorrect

**Solution:**
```bash
# Re-download sprite
curl https://raw.githubusercontent.com/SeakMengs/WindowPet/main/public/media/Nahida.png -o public/pets/sprites/genshin-nahida/sprite.png
```

### Issue: "Pet walks behind sidebar"

**Solution: Sidebar state not syncing**

Check in console:
```javascript
// Check sidebar state
JSON.parse(localStorage.getItem('oakcloud-ui-preferences')).sidebarCollapsed
```

Try toggling sidebar to see if it updates.

## Advanced Debugging

### Enable Phaser Debug Mode

Edit `src/game/config/phaser-config.ts`:
```typescript
physics: {
  default: 'arcade',
  arcade: {
    gravity: { y: 300, x: 0 },
    debug: true,  // Change to true
  },
},
```

This will show collision boxes and boundaries.

### Check Game Registry

In console:
```javascript
// Get Phaser game instance (if accessible)
// This might not work due to scope
```

### Check if Scene is Running

Add console.log to `src/game/scenes/PetScene.ts`:
```typescript
create() {
  console.log('PetScene created!', {
    characterId: this.registry.get('characterId'),
    bounds: this.bounds,
  });
  // ... rest of code
}
```

## Still Not Working?

### Full Reset

1. Clear localStorage:
```javascript
localStorage.clear();
```

2. Hard refresh: `Ctrl + Shift + R`

3. Set config again:
```javascript
localStorage.setItem('oakcloud-ui-preferences', JSON.stringify({
  petEnabled: true,
  selectedCharacter: 'genshin-nahida',
  petSettings: {scale: 1.0, speed: 1.0, soundEnabled: false},
  sidebarCollapsed: false,
  theme: 'light'
}))
```

4. Refresh again

### Check Build

Ensure latest build:
```bash
npm run build
npm run dev
```

### Provide Debug Info

If still not working, collect this info:
1. Console errors (screenshot)
2. Network tab (screenshot showing sprite.png request)
3. Output of:
```javascript
{
  storage: JSON.parse(localStorage.getItem('oakcloud-ui-preferences')),
  canvas: !!document.querySelector('.phaser-canvas-container'),
  currentPath: window.location.pathname,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
```
