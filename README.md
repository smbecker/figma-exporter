# Figma Export CLI

[Figma](https://www.figma.com/) is a design and prototyping tool. A common task after completing designs for a project is to export the designs into a presentation format like .PDF, .PNG, .JPG, or .SVG. This can be accomplished through the UI but with the recent release of the [Figma API](https://www.figma.com/developers/docs), this is a perfect candidate for some automation.

Huge credit to [gweltaz-calori/Figma-To-Pdf](https://github.com/gweltaz-calori/Figma-To-Pdf) as I leveraged a lot of the page detection and PDF export utilities from that project.

## Installing

Currently, installation must be done by first building and then linking. My eventual goal is to release this utility on NPM.

```shell
npm run build
npm link
```

## Usage

```shell
figma-export --help
```

### Configuring

Any command line option that can be passed in to the CLI can also be picked up through environment variables (i.e. FIGMA_option=value) or through the presence of a `figma-export.json` file any where in the current directory hierarchy.

```json
{
	"token": "foo",
	"directory": "C:/figma/projectA",
	"scale": 2,
	"format": "pdf"
}
```
