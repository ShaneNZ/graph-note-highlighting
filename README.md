# Graph Note Highlighting

An Obsidian plugin that shows your open notes on the graph view, and fades the rest of the graph by how far each note is from them.

## What it does

- **Active note** — the note you're editing is recoloured (or keeps its colour group colour), enlarged, and ringed. It stays highlighted when you click into the graph itself.
- **Visible notes** — notes showing in other panes (selected tabs in other splits, popout windows, and optionally expanded sidebars) get their own colour, size and ring. A setting can also count background tabs: either those in the active note's split, or all of them.
- **Fade by distance** — every open note lights up the notes around it, losing brightness with each link. Light from several open notes adds up, so a note linked to two open notes is brighter than one linked to only one of them. Every note keeps a minimum opacity, so the whole graph stays faintly visible.
- Distance is measured over the links the graph is actually drawing, so graph filters apply and unlinked mentions are ignored.
- With no notes open, the graph is drawn exactly as Obsidian draws it.
- Works in the global graph and in local graphs.

Notes that aren't open keep their colour-group colour; only their opacity changes.

## Settings

| Setting | Default |
|---|---|
| Active note colour (or keep its colour group colour) / size | kept, 1× |
| Active note ring: colour / width / gap | white, 2 px, 3 px |
| Visible note colour (or keep its colour group colour) / size | white, 1× |
| Visible note ring: colour / width / gap | off (white, 1 px, 2 px) |
| Visible note reach (relative to the active note) | 0.8 |
| Count as visible: notes on screen only / plus background tabs in the active split / plus all background tabs | on screen only |
| Brightness kept per hop | 0.5 |
| Minimum opacity | 0.1 |
| Count notes in expanded sidebars | on |
| Fade labels / fade links | on |

A command, **Toggle graph highlighting**, turns it on and off.

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
