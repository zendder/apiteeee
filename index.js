// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour for most endpoints
const THUMBNAIL_CACHE_TTL = 10 * 1000; // 10 seconds for thumbnails
const ASSET_INFO_CACHE_TTL = 20 * 1000; // 20 seconds for asset info
const MAX_ASSET_INFO_REQUESTS = 10; // Maximum number of asset IDs for /assetinfoz/
const ASSET_INFO_TIMEOUT = 5000; // 5 seconds timeout for individual asset info requests

document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    app.innerHTML = mainPageHtml;

    window.addEventListener('popstate', handleRouteChange);
    document.body.addEventListener('click', handleLinkClick);

    handleRouteChange();
});

function handleLinkClick(e) {
    if (e.target.tagName === 'A') {
        e.preventDefault();
        const href = e.target.getAttribute('href');
        history.pushState(null, '', href);
        handleRouteChange();
    }
}

function handleRouteChange() {
    const path = window.location.pathname;
    const [, endpoint, param] = path.split('/');

    switch (endpoint) {
        case 'asset':
            handleThumbnailRequest(param);
            break;
        case 'assetinfo':
            handleAssetInfoRequest(param);
            break;
        case 'assetinfoz':
            handleMultipleAssetInfoRequest(param.split(','));
            break;
        case 'assetversionid':
            handleAssetVersionIdRequest(param);
            break;
        case 'rbxm':
            handleRbxmRequest(param);
            break;
        case 'users':
            handleUsersRequest(param);
            break;
        case 'inventory':
            handleInventoryRequest(param);
            break;
        default:
            document.getElementById('app').innerHTML = mainPageHtml;
    }
}

async function handleThumbnailRequest(assetId) {
    const cacheKey = `thumbnail:${assetId}`;
    const cachedResponse = getFromCache(cacheKey, THUMBNAIL_CACHE_TTL);

    if (cachedResponse) {
        displayImage(cachedResponse);
        return;
    }

    const thumbnailUrl = `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`;

    try {
        const response = await fetch(thumbnailUrl);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            const imageUrl = data.data[0].imageUrl;
            const imageResponse = await fetch(imageUrl);
            const blob = await imageResponse.blob();

            setCache(cacheKey, blob, THUMBNAIL_CACHE_TTL);
            displayImage(blob);
        } else {
            document.getElementById('app').innerHTML = 'Image not found';
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('app').innerHTML = 'Not found';
    }
}

function displayImage(blob) {
    const imageUrl = URL.createObjectURL(blob);
    document.getElementById('app').innerHTML = `<img src="${imageUrl}" alt="Asset Thumbnail">`;
}

async function handleAssetInfoRequest(assetId) {
    const cacheKey = `assetinfo:${assetId}`;
    const cachedResponse = getFromCache(cacheKey, ASSET_INFO_CACHE_TTL);
    if (cachedResponse) {
        displayJson(cachedResponse);
        return;
    }

    try {
        const data = await fetchSingleAssetInfo(assetId);
        if (data.error) {
            document.getElementById('app').innerHTML = 'Asset not found';
            return;
        }

        const formattedData = formatAssetInfo(data);
        setCache(cacheKey, formattedData, ASSET_INFO_CACHE_TTL);
        displayJson(formattedData);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('app').innerHTML = 'Not Found';
    }
}

async function handleMultipleAssetInfoRequest(assetIds) {
    if (assetIds.length > MAX_ASSET_INFO_REQUESTS) {
        document.getElementById('app').innerHTML = 'Too many asset IDs. Maximum allowed is ' + MAX_ASSET_INFO_REQUESTS;
        return;
    }

    const cacheKey = `assetinfoz:${assetIds.join(',')}`;
    const cachedResponse = getFromCache(cacheKey, ASSET_INFO_CACHE_TTL);
    if (cachedResponse) {
        displayJson(cachedResponse);
        return;
    }

    try {
        const assetInfoPromises = assetIds.map(fetchSingleAssetInfo);
        const assetInfoResponses = await Promise.all(assetInfoPromises);

        const formattedData = {
            data: assetInfoResponses
                .filter(data => data && !data.error)
                .map(formatAssetInfo)
        };

        setCache(cacheKey, formattedData, ASSET_INFO_CACHE_TTL);
        displayJson(formattedData);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('app').innerHTML = 'Not Found';
    }
}

async function fetchSingleAssetInfo(assetId) {
    const cacheKey = `assetinfo:${assetId}`;
    const cachedResponse = getFromCache(cacheKey, ASSET_INFO_CACHE_TTL);
    if (cachedResponse) return cachedResponse;

    const assetInfoUrl = `https://economy.roblox.com/v2/assets/${assetId}/details`;

    try {
        const response = await fetchWithTimeout(assetInfoUrl, ASSET_INFO_TIMEOUT);
        const data = await response.json();
        setCache(cacheKey, data, ASSET_INFO_CACHE_TTL);
        return data;
    } catch (error) {
        console.error(`Error fetching asset ${assetId}:`, error);
        return { error: true, assetId };
    }
}

function formatAssetInfo(data) {
    return {
        asset: {
            audioDetails: null,
            id: data.AssetId,
            name: data.Name,
            typeId: data.AssetTypeId,
            assetSubTypes: [],
            assetGenres: ["All"],
            ageGuidelines: null,
            isEndorsed: false,
            description: data.Description,
            duration: 0,
            hasScripts: false,
            createdUtc: data.Created,
            updatedUtc: data.Updated,
            creatingUniverseId: null,
            isAssetHashApproved: true,
            visibilityStatus: 0,
            socialLinks: []
        },
        creator: {
            id: data.Creator.Id,
            name: data.Creator.Name,
            type: data.Creator.CreatorType === "User" ? 1 : 2,
            isVerifiedCreator: data.Creator.HasVerifiedBadge,
            latestGroupUpdaterUserId: null,
            latestGroupUpdaterUserName: null
        },
        voting: {
            showVotes: true,
            upVotes: 0,
            downVotes: 0,
            canVote: true,
            userVote: null,
            hasVoted: false,
            voteCount: 0,
            upVotePercent: 0
        }
    };
}

async function handleAssetVersionIdRequest(versionId) {
    const cacheKey = `assetversionid:${versionId}`;
    const cachedResponse = getFromCache(cacheKey);

    let result;
    if (cachedResponse) {
        result = cachedResponse;
    } else {
        const assetVersionUrl = `https://assetdelivery.roblox.com/v1/assetversionid/${versionId}`;

        try {
            const response = await fetch(assetVersionUrl);
            const data = await response.json();

            result = {
                ...data,
                rbxm: `/rbxm/${encodeURIComponent(data.location)}`
            };

            const contentResponse = await fetch(data.location);
            const contentString = await contentResponse.text();

            if (data.assetTypeId === 13) {
                const assetId = extractDecalAssetId(contentString);
                result.assetId = assetId || "No assetId found";
            } else {
                const assetIds = extractAssetIds(contentString);
                result.assetId = assetIds.length > 0 ? assetIds.join(',') : "No assetId found";
            }

            setCache(cacheKey, result);
        } catch (error) {
            console.error('Error:', error);
            document.getElementById('app').innerHTML = 'Not Found';
            return;
        }
    }

    result.requestId = generateRandomRequestId();
    displayJson(result);
}

function generateRandomRequestId() {
    const prefix = "638601530";
    const randomSuffix = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
    return prefix + randomSuffix;
}

function extractAssetIds(content) {
    const regex = /rbxassetid:\/\/(\d{10,16})/g;
    const matches = [...content.matchAll(regex)];
    return matches.map(match => match[1]);
}

function extractDecalAssetId(content) {
    const regex = /<url>http:\/\/www\.roblox\.com\/asset\/\?id=(\d+)<\/url>/;
    const match = content.match(regex);
    return match ? match[1] : null;
}

async function handleRbxmRequest(location) {
    try {
        const decodedLocation = decodeURIComponent(location);
        const response = await fetch(decodedLocation);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const filename = location.split('/').pop() + '.rbxm';

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.textContent = 'Download RBXM';
        
        document.getElementById('app').innerHTML = '';
        document.getElementById('app').appendChild(link);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('app').innerHTML = 'Not Found';
    }
}

async function handleUsersRequest(userIds) {
    const userIdArray = userIds.split(',');
    const cacheKey = `users:${userIds}`;
    const cachedResponse = getFromCache(cacheKey);
    if (cachedResponse) {
        displayJson(cachedResponse);
        return;
    }

    try {
        const userPromises = userIdArray.map(userId => 
            fetch(`https://users.roblox.com/v1/users/${userId}`)
                .then(response => response.json())
                .catch(() => null)
        );
        const userData = (await Promise.all(userPromises)).filter(Boolean);

        setCache(cacheKey, userData);
        displayJson(userData);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('app').innerHTML = 'Not Found';
    }
}

async function handleInventoryRequest(userId) {
    const cacheKey = `inventory:${userId}`;
    const cachedResponse = getFromCache(cacheKey);

    let inventoryData = cachedResponse || [];
    let lastUpdated = cachedResponse ? cachedResponse.lastUpdated : 0;

    const assetTypes = [1, 3, 4, 5, 9, 10, 13, 24, 40];
    const currentTime = Date.now();

    if (currentTime - lastUpdated > 60000) { // Update every minute
        for (const assetType of assetTypes) {
            let cursor = null;
            do {
                const url = `https://inventory.roblox.com/v2/users/${userId}/inventory/${assetType}?cursor=${cursor || ''}&limit=100&sortOrder=Desc`;
                try {
                    const response = await fetch(url);
                    const data = await response.json();

                    const newItems = data.data.filter(item => !inventoryData.some(existingItem => existingItem.userAssetId === item.userAssetId));

                    if (assetType === 13) {
                        const newItemsWithIds = await Promise.all(newItems.map(async item => {
                            if (item.assetType === 13 && item.assetName === 'Decal') {
                                try {
                                    const contentResponse = await fetch(item.location);
                                    const contentString = await contentResponse.text();
                                    const assetId = extractDecalAssetId(contentString);
                                    if (assetId) {
                                        item.assetId = assetId;
                                    }
                                } catch (error) {
                                    console.error('Error fetching decal content:', error);
                                }
                            }
                            return item;
                        }));
                        inventoryData = [...newItemsWithIds, ...inventoryData];
                    } else {
                        inventoryData = [...newItems, ...inventoryData];
                    }

                    cursor = data.nextPageCursor;
                } catch (error) {
                    console.error(`Error fetching inventory for asset type ${assetType}:`, error);
                    break;
                }
            } while (cursor);
        }

        inventoryData.sort((a, b) => new Date(b.created) - new Date(a.created));

        setCache(cacheKey, {
            data: inventoryData,
            lastUpdated: currentTime
        });
    }

    displayJson(inventoryData);
}

async function fetchWithTimeout(url, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

function getFromCache(key, ttl = CACHE_TTL) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data;
    }
    return null;
}

function setCache(key, data, ttl = CACHE_TTL) {
    cache.set(key, { 
        data: data,
        timestamp: Date.now(),
        ttl: ttl
    });
}

function displayJson(data) {
    document.getElementById('app').innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
}

const mainPageHtml = `
<h1>RBXG APIs</h1>
<ul>
  <li><strong>Thumbnail API:</strong> <a href="/asset/1818">/asset/{assetId}</a></li>
  <li><strong>Asset Info API:</strong> <a href="/assetinfo/1818">/assetinfo/{assetId}</a></li>
  <li><strong>Multiple Asset Info API:</strong> <a href="/assetinfoz/1818,1819,1820">/assetinfoz/{assetId1,assetId2,assetId3,...}</a> (max 10 IDs)</li>
  <li><strong>Asset Version ID API:</strong> <a href="/assetversionid/1818">/assetversionid/{versionId}</a></li>
  <li><strong>RBXM Download for assetversionid:</strong> <a href="/rbxm/1818">/rbxm/{id}</a></li>
  <li><strong>Users API:</strong> <a href="/users/1,2,3">/users/{userId1,userId2,...}</a></li>
  <li><strong>Inventory API:</strong> <a href="/inventory/1">/inventory/{userId}</a></li>
</ul>
<p>Replace {assetId}, {versionId}, {id}, {userId} with actual ids ok.</p>
`;

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled rejection (promise: ', event.promise, ', reason: ', event.reason, ').');
});
