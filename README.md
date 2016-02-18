# savetv-dl

This is a small node.js based tool for downloading your https://save.tv/ video collection.

## Installation

- Install node.js
- Clone this repository or download savetv-dl.js and package.json to a directory of your choice.
- Run "npm install" to download and install dependencies.
- Done, run it. Or setup a cronjob to run it at night, which may be more useful :).

## Usage

Run with `node savetv-dl -u USERNAME -p PASSWORD [-d /my/video/folder] [-n] [-r]`

Parameter | Description
----------|------------
-u | Your save.tv Username.
-p | Your save.tv Password.
-d | Saves the downloaded videos to this folder. This parameter is optional: when not specified, all videos are stored in the current folder. 
-n | Omits showing a progress bar while downloading. Useful when running this in a cronjob at night, when absolutely nobody is interested in the progress of a download. This parameter is optional.
-r | Removes video from your online collection after successful download.
