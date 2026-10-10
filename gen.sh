#!/bin/zsh
OUT=/Users/shin/Desktop/gems/dewpop/assets-src
run(){ name=$1; shift; codex exec --skip-git-repo-check -C $OUT "Use your built-in image generation tool (image_gen) to create exactly one image, then copy the generated PNG file to $OUT/$name . Do not draw it with code; it must come from the image generation tool. If the prompt asks for a transparent background, the final PNG must have a real alpha channel with a fully transparent background (if the generator returns a flat background, remove it cleanly). Reply only with the saved path.

IMAGE PROMPT:
$*" > $OUT/$name.log 2>&1 & }

run bg.png "Portrait mobile game background, 1024x1536. A cozy miniature mossy creek in a sunlit forest glade, seen slightly from above: clear turquoise water with soft caustic light, smooth rounded river pebbles, bright moss, tiny ferns and a small gentle waterfall at the very top, warm morning light, soft depth of field. Stylized soft 3D diorama render, trendy 2026 cozy mobile game art, vivid but calm, smooth gradients. Composition: the middle 70% of the frame is calm and low-detail (out-of-focus soft green-teal water) because a game board will overlay it; detail only near the top and the very bottom. No text, no UI, no characters, no logos."

run logo.png "Game logo wordmark on a fully transparent background: the word DEWPOP in big chunky rounded bubbly letters made of glossy translucent candy-colored liquid (each letter a different juicy color: coral, sunny yellow, mint, sky blue, grape purple, coral), like water droplets with strong white specular highlights, refraction and soft inner glow, a few tiny round droplets splashing around the last P, thick deep-teal outline. Trendy mobile puzzle game logo style. Spell exactly D-E-W-P-O-P. Nothing else, transparent background, 1536x640."

run icon.png "Square mobile game app icon art, 1024x1024: three glossy translucent candy-colored liquid droplets (coral, mint, sky blue) merging together inside a small rounded glass tank, splash with tiny droplets, strong specular highlights and refraction, on a fresh teal-to-deep-green gradient with soft light. Soft glossy 3D render, trendy casual mobile game style. No text."

run pebbles.png "Game sprite sheet, fully transparent background: exactly four smooth river pebbles in one horizontal row with wide even spacing, viewed straight from the front (side view, as if inside a glass aquarium), each pebble a different rounded shape (round, oval wide, oval tall, flat egg), soft grey-teal stone with subtle speckles, a little bright green moss on the top of each, wet glossy highlight at the upper-left, soft shading. Stylized premium cozy mobile game art. No text, no border, no ground shadow. 2048x512 canvas."

run pearl.png "Game sprite, fully transparent background: a single glowing iridescent pearl trapped inside a clear soap bubble, centered, pearl white with pink-cyan rainbow sheen, bubble rim with thin rainbow film and a bright specular highlight. Stylized premium mobile puzzle game art. No text, no border, no shadow. 1024x1024 canvas."
wait
