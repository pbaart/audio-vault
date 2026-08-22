import { Headphones } from "lucide-react";
import { useScaledMediaUrl } from "../lib/media";
import { cls } from "../ui";

interface MediaImageProps {
    relPath: string | null;
    className?: string;
    placeholderIcon?: number;
    /** Max dimension of a cached downscaled copy (see IMG_SIZE_*). */
    maxDim?: number;
}

/**
 * Renders a media file (image or FR graph) from the media directory via the
 * asset protocol, with a base64 fallback and a headphones placeholder.
 */
export function MediaImage({
    relPath,
    className = "",
    placeholderIcon = 40,
    maxDim,
}: MediaImageProps) {
    const { url, onAssetError } = useScaledMediaUrl(relPath, maxDim);

    if (!url) {
        return (
            <div
                className={cls(
                    "flex items-center justify-center bg-tm-darker text-tm-gray",
                    className,
                )}
            >
                <Headphones size={placeholderIcon} />
            </div>
        );
    }

    return (
        <img
            src={url}
            alt=""
            loading="lazy"
            onError={onAssetError}
            className={cls("object-cover", className)}
        />
    );
}
