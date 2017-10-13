# savetv-dl

This ~~is~~ was a small node.js based tool for downloading your https://save.tv/ video collection.

:exclamation:
**Please note that this tool doesn't work anymore, as save.tv changed their website-structure in the past and may now offer a real API. I don't use their service anymore, so this repository is for historical reasons only.**

## Installation

- Install node.js
- Clone this repository or download savetv-dl.js and package.json to a directory of your choice.
- Run "npm install" to download and install dependencies.
- Done, run it. Or setup a cronjob to run it at night, which may be more useful :).

## Usage

Run with `node savetv-dl -u USERNAME -p PASSWORD [-n] [-r] [-m user@domain.tld] [-d /my/video/folder]`

Parameter | Description
----------|------------
-u | Your save.tv Username.
-p | Your save.tv Password.
-d | Saves the downloaded videos to this folder. This parameter is optional: when not specified, all videos are stored in the current folder. 
-n | Omits showing a progress bar while downloading. Useful when running this in a cronjob at night, when absolutely nobody is interested in the progress of a download. This parameter is optional.
-r | Removes video from your online collection after successful download.
-m | Sends an email report to the given address. You must update the `mailserver` variable in savetv-dl.js to a valid smtp-account to use this feature.
