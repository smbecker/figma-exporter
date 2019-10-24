// borrows heavily from https://github.com/gweltaz-calori/Figma-To-Pdf/blob/master/utils/index.js

import { Document, ExternalDocument } from 'pdfjs';
import { cwd } from 'process';
import { join } from 'path';
import { createWriteStream, writeFile } from 'fs';
import * as request from 'request';

type FileDetails = {
	key: string;
	name: string;
	pages?: PageDetails[];
};

type PageDetails = {
	id: string;
	name: string;
	layers?: LayerDetails[];
};

type LayerDetails = {
	id: string;
	name?: string;
	imageUrl?: string;
	[name: string]: any;
};

type ExportOptions = {
	directory?: string;
	format?: string;
	scale?: number;
	firstPageOnly?: boolean;
};

const sortFrames = layers => {
	let lines = [];
	const sortedByHeight = layers.sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y);

	// tslint:disable-next-line:forin
	for (let page in sortedByHeight) {
		const pageItem = sortedByHeight[page];
		const nextPageItem = sortedByHeight[parseInt(page, 10) + 1];
		if (nextPageItem) {
			const midPoint = pageItem.absoluteBoundingBox.height / 2;

			if (Math.abs(nextPageItem.absoluteBoundingBox.y - pageItem.absoluteBoundingBox.y) <= midPoint) {
				if (lines.length === 0) {
					lines.push(pageItem);
				}
				lines.push(nextPageItem);
			} else {
				if (lines.length > 0) {
					const  index = sortedByHeight.findIndex((el) => el.id === lines[0].id);
					const sortedLine = lines.sort((a, b) => a.absoluteBoundingBox.x - b.absoluteBoundingBox.x);
					sortedByHeight.splice(index, sortedLine.length);
					sortedByHeight.splice(index, 0, ...sortedLine);
					lines = [];
				}
			}
		}
	}

	return sortedByHeight;
};

const get = (url: string, token: string): Promise<any> => {
	return new Promise<any>((resolve, reject) => {
		request({
			url,
			method: 'GET',
			headers: {
				'Accept': 'application/json',
				'X-Figma-Token': token
			},
			json: true
		}, (err, response, body) => {
			if (!err && response.statusCode !== 200) {
				err = new Error(`The request was not successful: ${url} [${response.statusCode}: ${JSON.stringify(body)}]`);
			}
			if (err) {
				return reject(err);
			}

			resolve(body);
		});
	});
};

const getProjectDetails = async (key: string, token: string): Promise<FileDetails[]> => {
	const body = await get(`https://api.figma.com/v1/projects/${key}/files`, token);
	return body.files;
};

const getFileDetails = async (key: string, token: string): Promise<FileDetails> => {
	const body = await get(`https://api.figma.com/v1/files/${key}`, token);
	const pages = body.document.children.filter(layer => layer.type === 'CANVAS')
		.map(page => ({
			id: page.id,
			name: page.name,
			layers: sortFrames(page.children.filter(layer => layer.type === 'FRAME')).map(frame => ({
				id: frame.id,
				name: frame.name
			}))
		}));
	return {
		key,
		name: body.name,
		pages
	};
};

const getLayerImageUrls = async (file: FileDetails, page: PageDetails, format: string, scale: number, token: string): Promise<void> => {
	const ids = page.layers.map(layer => layer.id).join(',');
	if (ids.length === 0) {
		return;
	}

	const body = await get(`https://api.figma.com/v1/images/${file.key}?ids=${ids}&format=${format}${(scale && scale > 0 ? `&scale=${scale}` : '')}`, token);
	for (let layer of page.layers) {
		layer.imageUrl = body.images[layer.id];
	}
};

const getPageImageUrls = async (file: FileDetails, firstPageOnly: boolean, format: string, scale: number, token: string): Promise<void> => {
	if (firstPageOnly) {
		await getLayerImageUrls(file, file.pages[0], format, scale, token);
	} else {
		const pagePromises = file.pages.map(page => getLayerImageUrls(file, page, format, scale, token));
		await Promise.all(pagePromises);
	}
};

const exportLayerOutput = (imageUrl: string, token: string, callback: (body: Buffer, cb: (err?) => void) => void): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		request({
			uri: imageUrl,
			method: 'GET',
			headers: {
				'X-Figma-Token': token
			},
			encoding: null
		}, (err, _, body) => {
			if (err) {
				reject(err);
			} else {
				callback(body, e => {
					if (e) {
						reject(e);
					} else {
						resolve();
					}
				});
			}
		});
	});
};

const exportLayer = async (output: string, imageUrl: string, token: string): Promise<string> => {
	await exportLayerOutput(imageUrl, token, (body, callback) => writeFile(output, body, callback));
	return output;
};

const exportPage = async (file: FileDetails, page: PageDetails, exportOptions: ExportOptions, imageFormat: string, token: string): Promise<string[]> => {
	const layerPromises = page.layers
		.filter(layer => layer.imageUrl && layer.imageUrl.length > 0)
		.map((layer, index) => {
			const name = index > 0
				? `${file.name}-${page.name}-${index + 1}.${imageFormat}`
				: `${file.name}-${page.name}.${imageFormat}`;
			const output = join(exportOptions.directory, name);
			return exportLayer(output, layer.imageUrl, token);
		});
	return await Promise.all(layerPromises);
};

const exportPages = async (file: FileDetails, exportOptions: ExportOptions, imageFormat: string, token: string): Promise<string[]> => {
	await getPageImageUrls(file, exportOptions.firstPageOnly, imageFormat, exportOptions.scale, token);
	
	const pagePromises = file.pages.map(page => exportPage(file, page, exportOptions, imageFormat, token));
	const result = await Promise.all(pagePromises);
	return result.reduce((a, b) => a.concat(b), []);
};

const exportPdfPage = async (file: FileDetails, page: PageDetails, exportOptions: ExportOptions, imageFormat: string, token: string): Promise<string[]> => {
	const document = new Document();

	const layers = page.layers.filter(x => x.imageUrl && x.imageUrl.length > 0);
	if (layers.length === 0) {
		return [];
	}

	for (let i = 0, count = layers.length; i < count; i++) {
		const layer = layers[i];

		await exportLayerOutput(layer.imageUrl, token, (body, callback) => {
			const external = new ExternalDocument(body);
			document.setTemplate(external);
			document.addPagesOf(external);
			callback();
		});
	}

	const name = exportOptions.firstPageOnly
		? `${file.name}.${imageFormat}`
		: `${file.name}-${page.name}.${imageFormat}`;
	const output = join(exportOptions.directory, name);
	document.pipe(createWriteStream(output));
	await document.end();

	return [output];
};

const exportPdfPages = async (file: FileDetails, exportOptions: ExportOptions, imageFormat: string, token: string): Promise<string[]> => {
	await getPageImageUrls(file, exportOptions.firstPageOnly, imageFormat, exportOptions.scale, token);
	
	const pagePromises = file.pages.map(page => exportPdfPage(file, page, exportOptions, imageFormat, token));
	const result = await Promise.all(pagePromises);
	return result.reduce((a, b) => a.concat(b), []);
};

const exportFormats = ['pdf', 'png', 'jpg', 'svg'];

export const exportFile = async (key: string, options: ExportOptions, token: string): Promise<string[]> => {
	const format = options && options.format || 'pdf';
	if (exportFormats.indexOf(format) === -1) {
		throw new Error(`The requested format is invalid: ${format}`);
	}

	const exporter = format === 'pdf'
		? exportPdfPages
		: exportPages;

	const details = await getFileDetails(key, token);
	if (details.pages && details.pages.length > 0) {
		return await exporter(details, Object.assign({}, {
			directory: cwd(),
			firstPageOnly: true
		}, options || {}), format, token);
	}

	return [];
};

export const exportProject = async (key: string, options: ExportOptions, token: string): Promise<string[]> => {
	const files = await getProjectDetails(key, token);
	const filePromises = files.map(file => exportFile(file.key, options, token));

	const output = await Promise.all(filePromises);
	return output.reduce((a, b) => a.concat(b), []);
};
