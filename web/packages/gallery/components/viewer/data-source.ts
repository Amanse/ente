/* xeslint-disable */
// x-@ts-nocheck

import log from "@/base/log";
import {
    downloadManager,
    type LivePhotoSourceURL,
} from "@/gallery/services/download";
import type { EnteFile } from "@/media/file";
import { FileType } from "@/media/file-type";
import { ensureString } from "@/utils/ensure";
// TODO:
import { extractRawExif, parseExif } from "@/new/photos/services/exif";

// TODO(PS):
//import { type SlideData } from "./ps5/dist/types/slide/"
interface SlideData {
    /**
     * image URL
     */
    src?: string | undefined;
    /**
     * image width
     */
    width?: number | undefined;
    /**
     * image height
     */
    height?: number | undefined;
    /**
     * html content of a slide
     */
    html?: string | undefined;
}

type ItemData = SlideData & {
    /**
     * If the file is a video, then this will be set to a renderable URL of the
     * original when it becomes available.
     */
    videoURL?: string;
    /**
     * If the file is a live photo, then this will be set to a renderable URL of
     * the original when it becomes available.
     */
    livePhotoVideoURL?: string;
    /**
     * `true` if we should indicate to the user that we're still fetching data
     * for this file.
     *
     * Note that this doesn't imply that the data is final. e.g. for a live
     * photo, this will be not be set after we get the original image component,
     * but the fetch for the video component might still be ongoing.
     */
    isContentLoading?: boolean;
    /**
     * This will be explicitly set to `false` when we want to disable
     * PhotoSwipe's built in image zoom.
     *
     * It is set while the thumbnail is loaded.
     */
    isContentZoomable?: boolean;
    /**
     * This will be `true` if the fetch for the file's data has failed.
     *
     * It is possible for this to be set in tandem with the content URLs also
     * being set (e.g. if we were able to use the cached thumbnail, but the
     * original file could not be fetched because of an network error).
     */
    fetchFailed?: boolean;
};

/**
 * This module stores and serves data required by our custom PhotoSwipe
 * instance, effectively acting as an in-memory cache.
 *
 * By keeping this independent of the lifetime of the PhotoSwipe instance, we
 * can reuse the same cache for multiple displays of our file viewer.
 *
 * This will be cleared on logout.
 */
class FileViewerDataSourceState {
    /**
     * The best data we have for a particular file (ID).
     */
    itemDataByFileID = new Map<number, ItemData>();
    /**
     * The latest callback registered for notifications of better data being
     * available for a particular file (ID).
     */
    needsRefreshByFileID = new Map<number, () => void>();
}

/**
 * State shared by functions in this module.
 *
 * See {@link FileViewerDataSourceState}.
 */
let _state = new FileViewerDataSourceState();

/**
 * Clear any internal state maintained by the file viewer data source.
 */
// TODO(PS): Call me during logout sequence once this is integrated.
export const logoutFileViewerDataSource = () => {
    _state = new FileViewerDataSourceState();
};

/**
 * Return the best available ItemData for rendering the given {@link file}.
 *
 * If an entry does not exist for a particular file, then it is lazily added on
 * demand, and updated as we keep getting better data (thumbnail, original) for
 * the file.
 *
 * At each step, we call the provided callback so that file viewer can call us
 * again to get the updated data.
 *
 * ---
 *
 * Detailed flow:
 *
 * If we already have the final data about the file, then this function will
 * return it and do nothing subsequently.
 *
 * Otherwise, it will:
 *
 * 1. Return empty slide data; PhotoSwipe will not show anything in the image
 *    area but will otherwise render UI controls properly (in most cases a
 *    cached renderable thumbnail URL will be available shortly).
 *
 * 2. Insert this empty data in its cache so that we don't enqueue multiple
 *    updates.
 *
 * Then it we start fetching data for the file.
 *
 * First it'll fetch the thumbnail. Once that is done, it'll update the data it
 * has cached, and notify the caller (using the provided callback) so it can
 * refresh the slide.
 *
 * Then it'll continue fetching the original.
 *
 * - For images and videos, this will be the single original.
 *
 * - For live photos, this will also be a two step process, first fetching the
 *   original image, then again the video component.
 *
 * At this point, the data for this file will be considered final, and
 * subsequent calls for the same file will return this same value unless it is
 * invalidated.
 *
 * If at any point an error occurs, we reset our cache for this file so that the
 * next time the data is requested we repeat the process instead of continuing
 * to serve the incomplete result.
 */
export const itemDataForFile = (file: EnteFile, needsRefresh: () => void) => {
    let itemData = _state.itemDataByFileID.get(file.id);

    // We assume that there is only one file viewer that is using us at a given
    // point of time. This assumption is currently valid.
    _state.needsRefreshByFileID.set(file.id, needsRefresh);

    if (!itemData) {
        itemData = { isContentLoading: true };
        _state.itemDataByFileID.set(file.id, itemData);
        void enqueueUpdates(file);
    }

    return itemData;
};

/**
 * Forget item data for the given {@link file} if its fetch had failed.
 *
 * This is called when the user moves away from a slide so that we attempt a
 * full retry when they come back the next time.
 */
export const forgetFailedItemDataForFile = (file: EnteFile) =>
    forgetFailedItemDataForFileID(file.id);

/**
 * Forget item data for the all files whose fetch had failed.
 *
 * This is called when the user closes the file viewer so that we attempt a full
 * retry when they reopen the viewer the next time.
 */
export const forgetFailedItems = () =>
    [..._state.itemDataByFileID.keys()].forEach(forgetFailedItemDataForFileID);

const forgetFailedItemDataForFileID = (fileID: number) => {
    if (_state.itemDataByFileID.get(fileID)?.fetchFailed) {
        _state.itemDataByFileID.delete(fileID);
    }
};

const enqueueUpdates = async (file: EnteFile) => {
    const update = (itemData: ItemData) => {
        _state.itemDataByFileID.set(file.id, itemData);
        _state.needsRefreshByFileID.get(file.id)?.();
    };

    // Use the last best available data, but stop showing the loading indicator
    // and instead show the error indicator.
    const markFailed = () => {
        const lastData = _state.itemDataByFileID.get(file.id) ?? {};
        delete lastData.isContentLoading;
        update({ ...lastData, fetchFailed: true });
    };

    try {
        const thumbnailURL = await downloadManager.renderableThumbnailURL(file);
        // While the types don't reflect it, it is safe to use the ! (null
        // assertion) here since renderableThumbnailURL can throw but will not
        // return undefined by default.
        const thumbnailData = await withDimensions(ensureString(thumbnailURL));
        update({
            ...thumbnailData,
            isContentLoading: true,
            isContentZoomable: false,
        });
    } catch (e) {
        // If we can't even get the thumbnail, then a network error is likely
        // (download manager already has retries); in particular, it cannot be a
        // format error since thumbnails are already standard JPEGs.
        //
        // Notify the user of the error. The entire process will be retried when
        // they reopen the slide later.
        //
        // See: [Note: File viewer error handling]
        log.error("Failed to fetch thumbnail", e);
        markFailed();
        return;
    }

    try {
        switch (file.metadata.fileType) {
            case FileType.image: {
                const sourceURLs =
                    await downloadManager.renderableSourceURLs(file);
                const itemData = await withDimensions(
                    ensureString(sourceURLs.url),
                );
                update(itemData);
                break;
            }

            case FileType.video: {
                const sourceURLs =
                    await downloadManager.renderableSourceURLs(file);
                // TODO(PS):
                update({ videoURL: sourceURLs.url as string });
                break;
            }

            case FileType.livePhoto: {
                const sourceURLs =
                    await downloadManager.renderableSourceURLs(file);
                const livePhotoSourceURLs =
                    sourceURLs.url as LivePhotoSourceURL;
                const imageURL = await livePhotoSourceURLs.image();
                const imageData = await withDimensions(ensureString(imageURL));
                update(imageData);
                const livePhotoVideoURL = await livePhotoSourceURLs.video();
                update({ ...imageData, livePhotoVideoURL });
                break;
            }
        }
    } catch (e) {
        // [Note: File viewer error handling]
        //
        // Generally, file downloads will fail because of two reasons: Network
        // errors, or format errors.
        //
        // In the first case (network error), the `renderableSourceURLs` method
        // above will throw. We will show an error indicator icon in the UI, but
        // will keep showing the thumbnail.
        //
        // In the second case (format error), we'll get back a URL, but if a
        // file conversion was needed but not possible (say, it is an
        // unsupported format), we might have at our hands the original file's
        // untouched URL, that the browser might not know how to render.
        //
        // In this case we won't get into an error state here, but PhotoSwipe
        // will encounter an error when trying to render it, and it will show
        // our customized error message ("This file could not be previewed"),
        // but the user will still be able to download it.
        log.error("Failed to fetch file", e);
        markFailed();
    }
};

/**
 * Take a image URL, determine its dimensions using browser APIs, and return the URL
 * and its dimensions in a form that can directly be passed to PhotoSwipe as
 * {@link ItemData}.
 */
const withDimensions = (imageURL: string): Promise<ItemData> =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () =>
            resolve({
                src: imageURL,
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
        image.onerror = reject;
        image.src = imageURL;
    });

/**
 * Return the Exif data for the given {@link file}, caching it appropriately.
 *
 * The shape of the returned data is such that it can directly be used by the
 * {@link FileInfo} sidebar.
 *
 * @see {@link forgetExif}.
 */
export const exifForItemData = async (itemData: ItemData) => {
    // Determine the (object) URL corresponding to the image portion, if any,
    // associated with the given itemData.
    //
    // - For images, this will be the object URL of the renderable image itself.
    // - For videos, this will not be defined.
    // - For live photos, this will be the object URL of the image portion of
    //   the live photo.
    const { src: associatedImageURL } = itemData;

    if (!associatedImageURL) {
        // This is a video. Use a placeholder.
        return { tags: undefined, parsed: undefined };
    }

    try {
        console.time("exif");
        const blob = await (await fetch(associatedImageURL)).blob();
        const file = new File([blob], "");
        const tags = await extractRawExif(file);
        const parsed = parseExif(tags);
        console.timeEnd("exif");
        return { tags, parsed };
    } catch (e) {
        log.error("Failed to extract exif", e);
        return { tags: undefined, parsed: undefined };
    }
};
