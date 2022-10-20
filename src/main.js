// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2022 Andy Holmes <andrew.g.r.holmes@gmail.com>

import * as artifact from '@actions/artifact';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';

import * as fs from 'fs';

import * as flatpak from './flatpak.js';
import * as utils from './utils.js';


/**
 * Generate a .flatpakrepo file and copy it to the repository directory.
 *
 * @param {PathLike} repoPath - A path to a Flatpak repository
 * @returns {Promise<>} A promise for the operation
 */
async function generateFlatpakrepo(repoPath) {
    /* Collect the .flatpakrepo fields */
    const {repository} = github.context.payload;
    const title = repository.name;
    const description = repository.description;
    const url = `https://${repository.owner.login}.github.io/${repository.name}`;
    const homepage = repository.homepage || repository.html_url;
    const icon = 'https://raw.githubusercontent.com/flatpak/flatpak/main/flatpak.png';

    /* Generate a .flatpakrepo file */
    let flatpakrepo =
`[Flatpak Repo]
Title=${title}
Description=${description}
Url=${url}
Homepage=${homepage}
Icon=${icon}`;

    /* Append the GPG Public Key */
    if (core.getInput('gpg-sign')) {
        const {stdout} = await exec.getExecOutput('gpg2',
            ['--armor', '--export', core.getInput('gpg-sign')]);
        const publicKey = stdout.split('\n').slice(2, -2).join('');
        flatpakrepo = `${flatpakrepo}\nGPGKey=${publicKey}`;
    }

    await fs.promises.writeFile(`${repoPath}/index.flatpakrepo`, flatpakrepo);
}

/**
 * Build and upload a Flatpak bundle.
 *
 * @param {PathLike} repo - A path to a Flatpak repository
 * @param {PathLike} manifest - A path to a Flatpak manifest
 * @returns {Promise<>} A promise for the operation
 */
async function uploadBundleArtifact(repo, manifest) {
    const metadata = await flatpak.parseManifest(manifest);
    const appId = metadata['app-id'] || metadata['id'];
    const branch = metadata['branch'] || metadata['default-branch'] || 'master';
    const fileName = `${appId}.flatpak`;

    await flatpak.buildBundle(repo, fileName, appId, branch);

    const artifactName = `${appId}-${core.getInput('arch')}`;
    const artifactClient = artifact.create();
    return artifactClient.uploadArtifact(artifactName, [fileName], '.', {
        continueOnError: false,
    });
}

/**
 * Build a Flatpak for the repository.
 *
 * A single repository cache is kept for all builds, while each architecture has
 * its own cache. This keeps the benefits of caching, while being able to serve
 * multiple architectures from the same repository.
 *
 * @param {PathLike} manifest - A path to a Flatpak manifest
 */
async function buildManifest(manifest) {
    const arch = core.getInput('arch');
    const checksum = await utils.checksumFile(manifest);
    const stateDir = `.flatpak-builder-${arch}-${checksum}`;

    let cacheId, cacheKey;
    if ((cacheKey = core.getInput('cache-key')) && cache.isFeatureAvailable()) {
        cacheKey = `${cacheKey}-${arch}-${checksum}`;
        cacheId = await cache.restoreCache([stateDir], cacheKey);
    }

    await flatpak.builder('_build', manifest, [
        `--state-dir=${stateDir}`,
    ]);

    if (cacheId && cacheId !== cacheKey) {
        await cache.saveCache([stateDir], cacheKey);
    }
}

/**
 * Run the action
 */
async function run() {
    const manifests = utils.getStrvInput('files');
    const repo = core.getInput('repo');

    /*
     * Rebuild the repository
     */
    await utils.restoreRepository();

    for (const manifest of manifests) {
        core.startGroup(`Building "${manifest}"...`);

        try {
            await buildManifest(manifest);
        } catch (e) {
            core.warning(`Failed to build "${manifest}": ${e.message}`);
        }

        core.endGroup();
    }

    if (core.getInput('gpg-sign')) {
        core.startGroup('Signing Flatpak repository...');

        await flatpak.buildSign(repo);
        await flatpak.buildUpdateRepo(repo);

        core.endGroup();
    }

    if (core.getBooleanInput('flatpakrepo')) {
        core.startGroup('Generating .flatpakrepo...');

        try {
            await generateFlatpakrepo(repo);
        } catch (e) {
            core.warning(`Failed to generate .flatpakrepo: ${e.message}`);
        }

        core.endGroup();
    }

    await utils.saveRepository();

    /*
     * GitHub Pages Artifact
     */
    if (core.getBooleanInput('upload-pages-artifact')) {
        core.startGroup('Uploading GitHub Pages artifact...');

        try {
            await utils.uploadPagesArtifact(repo);
        } catch (e) {
            core.warning(`Failed to upload GitHub Pages artifact: ${e.message}`);
        }

        core.endGroup();
    }

    /*
     * Flatpak Bundles
     */
    if (core.getBooleanInput('upload-flatpak-bundle')) {
        core.startGroup('Uploading Flatpak bundles...');

        for (const manifest of manifests) {
            try {
                await uploadBundleArtifact(repo, manifest);
            } catch (e) {
                core.warning(`Failed to upload "${manifest}": ${e.message}`);
            }
        }

        core.endGroup();
    }
}

run();

export default run;
    
