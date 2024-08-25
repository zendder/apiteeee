const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour for most endpoints
const THUMBNAIL_CACHE_TTL = 10 * 1000; // 10 seconds for thumbnails
const ASSET_INFO_CACHE_TTL = 20 * 1000; // 20 seconds for asset info
const MAX_ASSET_INFO_REQUESTS = 10; // Maximum number of asset IDs for /assetinfoz/
const ASSET_INFO_TIMEOUT = 5000; // 5 seconds timeout for individual asset info requests

app.use(express.json());

app.get('/', (req, res) => {
  res.send(mainPageHtml);
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).send();
});

app.get('/asset/:assetId', (req, res) => {
  handleThumbnailRequest(req.params.assetId, res);
});

app.get('/assetinfo/:assetId', (req, res) => {
  handleAssetInfoRequest(req.params.assetId, res);
});

app.get('/assetinfoz/:assetIds', (req, res) => {
  handleMultipleAssetInfoRequest(req.params.assetIds.split(','), res);
});

app.get('/assetversionid/:versionId', (req, res) => {
  handleAssetVersionIdRequest(req.params.versionId, res);
});

app.get('/rbxm/:location', (req, res) => {
  handleRbxmRequest(req.params.location, res);
});

app.get('/users/:userIds', (req, res) => {
  handleUsersRequest(req.params.userIds, res);
});

app.get('/inventory/:userId', (req, res) => {
  handleInventoryRequest(req.params.userId, res);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

async function handleThumbnailRequest(assetId, res) {
  const cacheKey = `thumbnail:${assetId}`;
  const cachedResponse = getFromCache(cacheKey, THUMBNAIL_CACHE_TTL);

  if (cachedResponse) {
    // Serve cached content immediately
    revalidateAndUpdateCache(cacheKey, assetId);
    res.set(cachedResponse.headers);
    res.send(cachedResponse.body);
    return;
  }

  // If not in cache, fetch new data
  fetchAndCacheThumbnail(cacheKey, assetId, res);
}

async function revalidateAndUpdateCache(cacheKey, assetId) {
  // Fetch new data in the background
  fetchAndCacheThumbnail(cacheKey, assetId).catch(console.error);
}

async function fetchAndCacheThumbnail(cacheKey, assetId, res) {
  const thumbnailUrl = `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`;

  try {
    const response = await axios.get(thumbnailUrl);
    const data = response.data;

    if (data.data && data.data.length > 0) {
      const imageUrl = data.data[0].imageUrl;
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageData = imageResponse.data;

      const finalResponse = new Response(imageData, {
        headers: { 'Content-Type': 'image/png' },
      });

      setCache(cacheKey, {
        body: imageData,
        headers: { 'Content-Type': 'image/png' },
      }, THUMBNAIL_CACHE_TTL);

      res.set(finalResponse.headers);
      res.send(imageData);
    } else {
      res.status(404).send('Image not found');
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Not found');
  }
}

async function handleAssetInfoRequest(assetId, res) {
  const cacheKey = `assetinfo:${assetId}`;
  const cachedResponse = getFromCache(cacheKey, ASSET_INFO_CACHE_TTL);
  if (cachedResponse) {
    res.set(cachedResponse.headers);
    res.send(cachedResponse.body);
    return;
  }

  try {
    const data = await fetchSingleAssetInfo(assetId);
    if (data.error) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    const formattedData = formatAssetInfo(data);
    const responseBody = JSON.stringify(formattedData);

    setCache(cacheKey, {
      body: responseBody,
      headers: { 'Content-Type': 'application/json' },
    }, ASSET_INFO_CACHE_TTL);

    res.json(formattedData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Not Found');
  }
}

async function handleMultipleAssetInfoRequest(assetIds, res) {
  if (assetIds.length > MAX_ASSET_INFO_REQUESTS) {
    res.status(400).send('Too many asset IDs. Maximum allowed is ' + MAX_ASSET_INFO_REQUESTS);
    return;
  }

  const cacheKey = `assetinfoz:${assetIds.join(',')}`;
  const cachedResponse = getFromCache(cacheKey, ASSET_INFO_CACHE_TTL);
  if (cachedResponse) {
    res.set(cachedResponse.headers);
    res.send(cachedResponse.body);
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

    const responseBody = JSON.stringify(formattedData);
    setCache(cacheKey, {
      body: responseBody,
      headers: { 'Content-Type': 'application/json' },
    }, ASSET_INFO_CACHE_TTL);

    res.json(formattedData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Not Found');
  }
}

async function fetchSingleAssetInfo(assetId) {
  const cacheKey = `assetinfo:${assetId}`;
  const cachedResponse = getFromCache(cacheKey, ASSET_INFO_CACHE_TTL);
  if (cachedResponse) return JSON.parse(cachedResponse.body);

  const assetInfoUrl = `https://economy.roblox.com/v2/assets/${assetId}/details`;

  try {
    const response = await Promise.race([
      fetchWithRetry(assetInfoUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ASSET_INFO_TIMEOUT))
    ]);

    setCache(cacheKey, {
      body: JSON.stringify(response),
      headers: { 'Content-Type': 'application/json' },
    }, ASSET_INFO_CACHE_TTL);

    return response;
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

async function handleAssetVersionIdRequest(versionId, res) {
  const cacheKey = `assetversionid:${versionId}`;
  const cachedResponse = getFromCache(cacheKey);

  let result;
  if (cachedResponse) {
    result = JSON.parse(cachedResponse.body);
  } else {
    const assetVersionUrl = `https://assetdelivery.roblox.com/v1/assetversionid/${versionId}`;

    try {
      const response = await axios.get(assetVersionUrl);
      const data = response.data;

      result = {
        ...data,
        rbxm: `/rbxm/${encodeURIComponent(data.location)}`
      };

      // Fetch the asset content to extract the asset ID
      const contentResponse = await axios.get(data.location);
      const contentString = contentResponse.data;

      if (data.assetTypeId === 13) {
        // For Decals (assetTypeId 13)
        const assetId = extractDecalAssetId(contentString);
        result.assetId = assetId || "No assetId found";
      } else {
        // For other asset types (including 40)
        const assetIds = extractAssetIds(contentString);
        result.assetId = assetIds.length > 0 ? assetIds.join(',') : "No assetId found";
      }

      setCache(cacheKey, {
        body: JSON.stringify(result),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Not Found');
      return;
    }
  }

  // Generate a new random requestId for each request
  result.requestId = generateRandomRequestId();

  res.json(result);
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

async function handleRbxmRequest(location, res) {
  try {
    const decodedLocation = decodeURIComponent(location);
    const response = await axios.get(decodedLocation, { responseType: 'arraybuffer' });
    const contentDisposition = `attachment; filename="${location.split('/').pop()}.rbxm"`;

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition
    });
    res.send(response.data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Not Found');
  }
}

async function handleUsersRequest(userIds, res) {
  const userIdArray = userIds.split(',');
  const cacheKey = `users:${userIds}`;
  const cachedResponse = getFromCache(cacheKey);
  if (cachedResponse) {
    res.set(cachedResponse.headers);
    res.send(cachedResponse.body);
    return;
  }

  try {
    const userPromises = userIdArray.map(userId => 
      axios.get(`https://users.roblox.com/v1/users/${userId}`)
        .then(response => response.data)
        .catch(() => null)
    );
    const userData = (await Promise.all(userPromises)).filter(Boolean);

    const responseBody = JSON.stringify(userData);
    setCache(cacheKey, {
      body: responseBody,
      headers: { 'Content-Type': 'application/json' },
    });

    res.json(userData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Not Found');
  }
}

async function handleInventoryRequest(userId, res) {
  const cacheKey = `inventory:${userId}`;
  const cachedResponse = getFromCache(cacheKey);

  let inventoryData = cachedResponse ? JSON.parse(cachedResponse.body) : [];
  let lastUpdated = cachedResponse ? cachedResponse.lastUpdated : 0;

  const assetTypes = [1, 3, 4, 5, 9, 10, 13, 24, 40];
  const currentTime = Date.now();

  if (currentTime - lastUpdated > 60000) { // Update every minute
    for (const assetType of assetTypes) {
      let cursor = null;
      do {
        const url = `https://inventory.roblox.com/v2/users/${userId}/inventory/${assetType}?cursor=${cursor || ''}&limit=100&sortOrder=Desc`;
        try {
          const response = await axios.get(url);
          const data = response.data;

          // Filter out items that are already in the inventory
          const newItems = data.data.filter(item => !inventoryData.some(existingItem => existingItem.userAssetId === item.userAssetId));

          // Handle asset type 13 separately
          if (assetType === 13) {
            const newItemsWithIds = await Promise.all(newItems.map(async item => {
              if (item.assetType === 13 && item.assetName === 'Decal') {
                try {
                  const contentResponse = await axios.get(item.location);
                  const contentString = contentResponse.data;
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
          // Skip this asset type and continue with the next one
          break;
        }
      } while (cursor);
    }

    // Sort the inventory data by creation date, newest first
    inventoryData.sort((a, b) => new Date(b.created) - new Date(a.created));

    // Update the cache
    setCache(cacheKey, {
      body: JSON.stringify(inventoryData),
      headers: { 'Content-Type': 'application/json' },
      lastUpdated: currentTime
    });
  }

  res.json(inventoryData);
}

async function fetchWithRetry(url, maxRetries = 5, delay = 1000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      lastError = error;
      if (error.response && error.response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        break; // Exit the loop for non-429 errors
      }
    }
  }
  throw lastError; // Throw the last error encountered
}

function getFromCache(key, ttl = CACHE_TTL) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.response;
  }
  return null;
}

function setCache(key, response, ttl = CACHE_TTL) {
  cache.set(key, { 
    response: response,
    timestamp: Date.now(),
    ttl: ttl
  });
}

const mainPageHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>rbxg apis</title>
</head>
<body>
  <h1>RBXG APIs</h1>
  <ul>
    <li><strong>Thumbnail API:</strong> /asset/{assetId}</li>
    <li><strong>Asset Info API:</strong> /assetinfo/{assetId}</li>
    <li><strong>Multiple Asset Info API:</strong> /assetinfoz/{assetId1,assetId2,assetId3,...} (max 10 IDs)</li>
    <li><strong>Asset Version ID API:</strong> /assetversionid/{versionId}</li>
    <li><strong>RBXM Download for assetversionid:</strong> /rbxm/{id}</li>
    <li><strong>Users API:</strong> /users/{userId1,userId2,...}</li>
    <li><strong>Inventory API:</strong> /inventory/{userId}</li>
  </ul>
  <p>Replace {assetId}, {versionId}, {id}, {userId} with actual ids ok.</p>
</body>
</html>
`;

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection (promise: ', promise, ', reason: ', reason, ').');
});
