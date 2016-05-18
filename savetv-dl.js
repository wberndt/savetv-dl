"use strict";

let stdio = require('stdio');
let https = require('https');
let http = require('http');
let path = require('path');
let url = require('url');
let fs = require('fs');
let progress = require('progress');

let tingodb = require('tingodb')();
let db = new tingodb.Db(__dirname,{});
let finishedDownloads = db.collection('savetv-dl.db');

let parameter = stdio.getopt({
    'user': {key: 'u', args: 1, mandatory: true, description: 'Save.TV username'},
    'password': {key: 'p', args: 1, mandatory: true, description: 'Save.TV password'},
    'directory': {key: 'd', args: 1, mandatory: false, description: 'Target directory for downloaded video files..'},
    'remove': {key: 'r', mandatory: false, description: 'Delete recordings from save.tv after sucessful download.'},
    'noprogess': {key: 'n', mandatory: false, description: 'Don\'t show progress bar while downloading.' }
});

let hostname = "www.save.tv";
let authcookie = undefined;
let createUrlFor = {
    login: function() { return '/STV/M/Index.cfm?sk=PREMIUM'; },
    list: function() { return '/STV/M/obj/archive/JSON/VideoArchiveApi.cfm?bAggregateEntries=false&iEntriesPerPage=1000&iRecordingState=1'; },
    download: function(id, format) { return `/STV/M/obj/cRecordOrder/croGetDownloadUrl.cfm?TelecastId=${id}&iFormat=${format}&bAdFree=true`; },
    remove: function(id) { return `/STV/M/obj/cRecordOrder/croDelete.cfm?TelecastID=${id}` }
};

/**
 * Sends requests to save.tv.
 *
 * @param options - A node.js http/https agent option object.
 * @param postData - Data that is send when requesting via POST
 * @param isVideoDownload - Is this an api-request or video-download?
 * @returns {Promise} - Promise resolving with the location path of the downloaded video (when isVideoDownload=true)
 * or the response-header and -body of the api-request (when isVideoDownload=false).
 */
let requestFromServer = function(options, postData, isVideoDownload) {
    return new Promise(function(resolve, reject) {
        let req = null;

        if(isVideoDownload) {
            // Video files are downloaded via http.

            req = http.request(options, function (response) {
                // Get video file name from the "content-disposition"-header of save.tvs response:
                // 'content-disposition': 'attachment; filename=FILENAME_FROM_SAVETV.mp4'
                if(!response.headers['content-disposition'])
                    return reject("Server didn't respond with video file.");
                let filename = response.headers['content-disposition'].replace("attachment; filename=","");

                // Write data to temporary file in local directory and move that to its final location when
                // finished.
                let temppath = path.join('./', filename + ".savetv_temp");
                let destpath = path.join(parameter.directory || './', filename);

                var file = fs.createWriteStream(temppath);
                response.pipe(file);

                file.on('finish', function() {
                    file.close();

                    // fs.rename(..) doesn't work here, because the file destination could be on another partition
                    // (external hdd, etc..)
                    var is = fs.createReadStream(temppath);
                    var os = fs.createWriteStream(destpath);
                    is.pipe(os);
                    is.on('end',function() {
                        fs.unlinkSync(temppath);
                        return resolve(destpath);
                    });
                });

                // Just some eyecandy.
                if(!parameter.noprogess) {
                    let filesize = parseInt(response.headers['content-length']);
                    let bar = new progress('Download in progress: [:bar] :percent :etas',
                        {complete: '=', incomplete: ' ', width: 40, total: filesize, renderThrottle: 1000});

                    response.on('data', function (chunk) {
                        bar.tick(chunk.length);
                    });
                }
            });
        } else {
            // API requests are done via HTTPS.

            req = https.request(options, function (response) {
                response.setEncoding('utf-8');

                let data = '';
                response.on('data', function (chunk) {
                    data += chunk;
                });

                response.on('end', function () {
                    // return header and body information
                    return resolve({header: response.headers, body: data});
                })
            });
        }

        if(options.method || options.method === "POST") {
            req.write(postData);
        }
        req.end();

        req.on('error', function(err) {
           return reject(err);
        });
    });
};

/**
 * Login to save.tv
 *
 * @param user - Save.TV username.
 * @param pass - Save.TV password.
 * @returns {Promise} - Promise resolving with an auth-token that can be used for further requests.
 */
let login = function(user, pass) {
    return new Promise(function(resolve, reject) {
        let authstring = `sUsername=${user}&sPassword=${pass}&value=Login`;

        let options = {
            hostname: hostname,
            path: createUrlFor.login(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': authstring.length
            },
            method: 'POST'
        };

        requestFromServer(options, authstring).then(function(result) {
            if(result.body.indexOf("Login_Succeed") > -1) {
                // Result from server:   ['SNUUID=xxx;path=/']
                // We care about that part ^^^^^^^^^^
                resolve(result.header['set-cookie'][0].split(';')[0]);
            } else  {
                reject("Login denied.");
            }
        }).catch(function(err) {
            reject(err);
        });
    });
};

/**
 * Gets videolist from save.tv.
 *
 * @returns {Promise} Promise resolving with a list of all available videos.
 */
let getVideoList = function() {
    return new Promise(function(resolve, reject) {
        if(!authcookie) return reject(new Error("No auth cookie set, did you login?"));

        let options = {
            'hostname': hostname,
            'path': createUrlFor.list(),
            'headers': {
                'Cookie': authcookie
            }
        };

        requestFromServer(options).then(function(result) {
            let data = JSON.parse(result.body);
            let list = [];
            data.ARRVIDEOARCHIVEENTRIES.forEach(function(entry) {
                // Most videos have multiple download options. We filter out all options that contain ads and sort
                // the remaining by quality.
                let formats = entry.STRTELECASTENTRY.ARRALLOWDDOWNLOADFORMATS
                    // Throw away ads.
                    .filter(function(value) { return value.BADCUTENABLED; })
                    // Order by quality. Higher number in RECORDINGFORMATID means better quality (6=HD, 5=SD with hq
                    // encoder settings, 4=SD with "mobile" encoder settings, et...).
                    .sort(function(a,b) {
                        return (a.RECORDINGFORMATID > b.RECORDINGFORMATID) ? -1 : ((a.RECORDINGFORMATID < b.RECORDINGFORMATID) ? 1 : 0);
                    });

                list.push({
                    // Save.TV "Telecast-ID" for this video.
                    id: entry.STRTELECASTENTRY.ITELECASTID,
                    // Friendly name for console-output.
                    name: (entry.STRTELECASTENTRY.SSUBTITLE) ? entry.STRTELECASTENTRY.STITLE + " - " + entry.STRTELECASTENTRY.SSUBTITLE : entry.STRTELECASTENTRY.STITLE,
                    // Highest available quality index for this video or undefined, when there isn't any download option left after our filtering.
                    highestQuality: (formats.length > 0) ? formats[0].RECORDINGFORMATID : undefined
                });
            });
            resolve(list);
        }).catch(function(err) {
            reject(err);
        });
    });
};

/**
 * Requests a download-url for a video from save.tv.
 *
 * @param video - Videoitem from getVideoList(). Must contain {id:, highestQuality:}
 * @returns {Promise} - Promise resolving with the download-url.
 */
let getDownloadUrl = function(video) {
    return new Promise(function(resolve, reject) {
        if(!authcookie) return reject("No auth cookie set, did you login?");

        let options = {
            'hostname': hostname,
            'path': createUrlFor.download(video.id, video.highestQuality),
            'headers': {
                'Cookie': authcookie
            }
        };

        let getUrlFromArray = function(arr) {
            return (arr.ARRVIDEOURL[1] === "OK") ? arr.ARRVIDEOURL[2] : undefined;
        };

        requestFromServer(options).then(function(result) {
            let url;
            if (url = getUrlFromArray(JSON.parse(result.body))) {
                return resolve(url);
            } else {
                return reject("No download url from server.");
            }
        }).catch(function(err) {
            reject(err);
        });
    });
};

/**
 * Downloads a video from Save.TV.
 *
 * @param downloadUrl - Download URL.
 * @returns {Promise} - Promise resolving with the path to the downloaded video.
 */
let downloadVideo = function(downloadUrl) {
    return new Promise(function (resolve, reject) {
        if(!authcookie) return reject("No auth cookie set, did you login?");

        let urlparts = url.parse(downloadUrl);

        let options = {
            'hostname': urlparts.hostname,
            'path': urlparts.path,
            'port': 80
        };

        requestFromServer(options, null, true).then(function(destination) {
            resolve(destination);
        }).catch(function(err) {
            reject(err);
        });
    });
};

/**
 * Deletes a video from save.tv
 *
 * @param id - Telecast-Id of the recording.
 * @returns {Promise} - Promise resolving with "true" when the video was deleted.
 */
let removeVideo = function(id) {
    return new Promise(function(resolve, reject) {
        // do nothing when delete parameter wasn't set
        if(!parameter.remove) return resolve(false);

        if(!authcookie) return reject("No auth cookie set, did you login?");

        let options = {
            'hostname': hostname,
            'path': createUrlFor.remove(id),
            'headers': {
                'Cookie': authcookie
            }
        };

        requestFromServer(options).then(function() {
            resolve(true);
        }).catch(function(err) {
            reject(err);
        });

    });
};

/**
 * Checks if a video was already downloaded and starts a download if not.
 *
 * @param video - Videoitem from getVideoList.
 * @returns {Promise} - Promise resolving when download was successful or video was already downloaded.
 */
let handleSingleVideo = function(video) {
    return new Promise(function(resolve, reject) {
        finishedDownloads.find({"telecastId": video.id}).count(function (err, c) {
            if (err) return reject(err);

            if (c === 0) {
                if(!video.highestQuality) return reject("No ad-free download available.");

                let getQualityString = function(quality) {
                    switch(quality) {
                        case 6: return "H264 HD";
                        case 5: return "H264 SD high quality";
                        case 4: return "H264 SD mobile";
                        default: return quality;
                    }
                };
                console.log(`Video is new, starting download. (Using quality: ${getQualityString(video.highestQuality)})`);

                getDownloadUrl(video)
                    .then(function(url) {  return downloadVideo(url); })
                    .then(function(destination) {
                        console.log(`Download complete, saved video to ${destination}`);
                        // Save video-id to database, so we don't download it again.
                        return new Promise(function(resolve, reject) {
                            finishedDownloads.insert({"telecastId": video.id},
                                function (err) { if (err) return reject(err); else return resolve(); });
                        });
                    })
                    .then(function() {
                        return removeVideo(video.id);
                    })
                    .then(function(deletedVideo) {
                        if(deletedVideo) console.log("Removed video from online collection.");
                        return resolve();
                    })
                    .catch(function (err) {
                        return reject(err)
                    });
            } else {
                console.log("Video was already downloaded.");
                return resolve();
            }
        });
    });
};


/**
 * Removes partial downloaded files from crashed previous runs.
 *
 * @returns {Promise}
 */
let cleanUp = function() {
    return new Promise(function(resolve, reject) {
        // Iterate through current directory and delete all files with a .savetv_temp extension.
        fs.readdir('./', function(err, files) {
            if(err) return reject(err);

            files.forEach(function(file) {
                if(path.extname(file) === ".savetv_temp") {
                    console.log(`Removing old tempfile: ${file}`);
                    fs.unlinkSync(path.join('./', file));
                }
            });

            return resolve();
        });
    });
};


cleanUp()
    .then(function() {
        return login(parameter.user, parameter.password)
    })
    .then(function(cookie) {
        console.log("Login successful.");
        authcookie=cookie;

        return getVideoList();
    })
    .then(function(videoList) {
        console.log(`You have ${videoList.length} videos in your collection.`);

        // Create a promise chain with a handleSingleVideo() call for every item in our list. This makes sure that
        // the videos are downloaded one after another instead of having multiple, slow downloads running at the
        // same time.
        let num = 1;
        videoList.reduce(function(prev, current) {
            return prev.then(function() {
                console.log(`[Video ${num++}/${videoList.length}, ID ${current.id}]: ${current.name}:`);
                return handleSingleVideo(current);
            }).catch(function(err) {
                // Skip to next video on error
                console.log("Error:", err);
            });
        }, Promise.resolve());
    })
    .catch(function(err) {
        console.log("Whoops:", err);
    });
