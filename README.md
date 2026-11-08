# Graph Note Highlighting

An Obsidian plugin that shows your open notes on the graph view, and fades the rest of the graph by how far each note is from them.

## What it does

- **Active note** — the note you're editing is recoloured (or keeps its colour group colour), enlarged, and ringed. It stays highlighted when you click into the graph itself.
- **Open notes** — notes showing in other panes (selected tabs in other splits, popout windows, and optionally the sidebars) get their own colour, size and ring. Background tabs count too: either those in the active note's split (the default), or all of them.
- **Fade by distance** — every open note lights up the notes around it, losing brightness with each link. Light from several open notes adds up, so a note linked to two open notes is brighter than one linked to only one of them. Every note keeps a minimum opacity, so the whole graph stays faintly visible.
- Distance is measured over the links the graph is actually drawing, so graph filters apply and unlinked mentions are ignored.
- With no notes open, the graph is drawn exactly as Obsidian draws it.
- **Click to switch** — clicking a note in the graph that is already open in a tab switches to that tab instead of opening the note again. Modifier clicks (such as Cmd-click to open in a new tab) and tag clicks work as normal.
- Works in the global graph and in local graphs.

Notes that aren't open keep their colour-group colour; only their opacity changes.

## Settings

| Setting | Default |
|---|---|
| Include tags: when the graph shows tags, light up tags on the active and open notes, and the notes that share them | on |
| Highlight active note (off: the active note is treated as an open note) | on |
| Active note colour (or keep its colour group colour) / size | kept, 1× |
| Active note ring: colour (or match the note colour) / width / gap | white, 2 px, 3 px |
| Highlight connected notes: style the notes linked to the active note; their links blend from the colour at one end to the other (ring colour, or dot colour without a ring) | off |
| Connected note colour (or keep its colour group colour) / size | kept, 1× |
| Connected note ring: colour (or match the note colour) / width / gap | white, 1 px, 2 px |
| Connected notes: always display node names (at every zoom level) | on |
| Open note colour (or keep its colour group colour) / size | white, 1× |
| Open note ring: colour (or match the note colour) / width / gap | off (white, 1 px, 2 px) |
| Open note reach (relative to the active note) | 0.8 |
| Count as open: tabs in the active split / all tabs (notes showing in other panes always count) | tabs in the active split |
| Maximum hops: how many links away from an open note are lit up | 3 |
| Minimum brightness for connected notes: brightness at the last lit hop, reached in even steps (step per hop is shown) | 0.25 |
| Minimum opacity | 0.1 |
| Count notes in the sidebars | on |
| Open notes: always display node names (at every zoom level) | off |
| Fade labels / fade links | on |

To turn the plugin off, disable it under Community plugins.

## How it works

Obsidian draws the graph with PixiJS, so CSS can't style individual nodes. This plugin patches the prototype methods Obsidian's graph nodes and links use each frame (`getFillColor`, `getSize`, `render`), and recomputes opacities when tabs change. These are undocumented internals, verified against Obsidian 1.15; an Obsidian update may break them.

Inspired by [Graph Style Customizer](https://github.com/CreamNuts/obsidian-graph-style-customizer).

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # production build
npm run lint
```
