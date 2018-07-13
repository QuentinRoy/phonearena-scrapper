# Phonearena Scrapper

A cli script that scraps phonearena.com for their data.

## Install

The script have been developped for [`node.js`](nodejs.org) 10 and [`yarn`](yarnpkg.com).
It might work with other nodejs versions and `npm`, but I haven't tested.

```sh
git clone https://github.com/QuentinRoy/phonearena-scrapper.git
cd phonearena-scrapper
yarn install
```

## Start

```sh
yarn start
```

## CLI arguments

    -V, --version            output the version number
    -u, --update [date]      Update (re-scape) existing data file if they were scrapped before the provided date.
    -c, --concurrency <n>    Number of parallel scrapping (default: 20)
    --scrapping-retry <n>    Number of time a scrapping should be retried if failed (default: 1)
    --loading-retry <n>      Number of time a page loading should be retried if failed (default: 3)
    --no-headless            If the scrapping should happening without showing the browser
    -o, --output-dir <path>  Output directory (default: ./out)
    -s, --success-only       Stop at the first unsuccessful scrapping
    -h, --help               output usage information
    
See `yarn start --help`.
