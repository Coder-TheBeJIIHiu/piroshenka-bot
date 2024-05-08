const fs = require('fs');
const path = require('path');

function getDirectoryTree(dir) {
		const stats = fs.statSync(dir);
		if (!stats.isDirectory()) {
				return null;
		}

		const tree = {
				name: path.basename(dir),
				path: dir,
				type: 'directory',
				children: []
		};

		const files = fs.readdirSync(dir);
		files.forEach(file => {
				const filePath = path.join(dir, file);
				const fileStats = fs.statSync(filePath);

				if (fileStats.isDirectory() && file !== 'node_modules') {
						const subtree = getDirectoryTree(filePath);
						if (subtree !== null) {
								tree.children.push(subtree);
						}
				} else if (fileStats.isFile()) {
						tree.children.push({
								name: file,
								path: filePath,
								type: 'file'
						});
				}
		});

		return tree;
}

const directoryPath = '../';
const directoryTree = getDirectoryTree(directoryPath);
console.log(JSON.stringify(directoryTree, null, 2));
