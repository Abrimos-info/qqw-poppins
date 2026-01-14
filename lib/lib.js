const errorCatcher = require('async-error-catcher');
const catchError = errorCatcher.default;
const cloneDeep = require('lodash/cloneDeep')
const sortBy = require('lodash/sortBy')
const Qqw = require('qqw');
const constants = require('./const');
const Parser = require('rss-parser');
const moment = require('moment');
const helpers = require('./helpers').helpers;
const https = require("https");
const csv = require('@vanillaes/csv');
const fs = require('fs');
const path = require('path');

function loadSettings(app,callback) {
  console.log("Load settings...")

  //After settings load sources from api, read toloco from disk and query the feed
  Promise.all([
    // Configuración general: id-conf, valor
    // Buscadores: tipo-buscador, id-elemento
    // Estáticos home: id-elemento, valor
    // Notas en perfiles: id-perfil, url-nota, titulo-nota, fecha-nota, medio, autor, explicacion-relacion
    appLocalsFromCSV(app,"general",process.env.CSVSETTINGS_GENERAL_URL,["id","staging","production"]),
    appLocalsFromCSV(app,"buscadores",process.env.CSVSETTINGS_BUSCADORES_URL,["tipo-buscador","id"]),
    appLocalsFromCSV(app,"notas",process.env.CSVSETTINGS_NOTAS_URL,["id","url","titulo","fecha","medio","autor","explicacion_es","explicacion_en"]),

    package_version(app,"package")
  ]).then(()=>{
    sources_cache(app,"sources").then(()=>{
      toloco_get_data(app,"toloco"),
      feed_cache(app,"feed"),

      callback(app.locals);
    }).catch(e => {
      console.error("Error loading sources",e)
      process.exit(1);
    })
  }).catch(e => {
    console.error("Error loading settings",e)
    process.exit(1);
})
  // console.log("app locals",app.locals)
}

function reloadSettingsView(collection,templateName,idFieldName) {
  return catchError(async function(req, res, next) {
    loadSettings(res.app,function(appLocals) {
      res.json({
        "general": appLocals.general,
        "buscadores": appLocals.buscadores,
        "notas": appLocals.notas,
        "sources": appLocals.sources,
        "toloco": appLocals.toloco,
        "feed": appLocals.feed
      })

    })
  })
}

async function package_version(app,namespace) {
  var pjson = require('../package.json');
  let fileContents = fs.readFileSync(".git/HEAD", 'utf8');
  if (fileContents.indexOf("refs/") > -1) {
    fileContents = fs.readFileSync(".git/ORIG_HEAD", 'utf8');
  }
  app.locals[namespace] = {
    version: pjson.version,
    commit: fileContents,
    commit_short: fileContents.substr(0,7)
  }
}

async function sources_cache(app,namespace) {
  console.log("Loading sources")
  let sources;
  let filters = {};

  //TODO: Remove
  filters["db_prefix"] = db_prefix;  
  
  try {
    sources = await getAPI({app: app},"sources",filters);
  }
  catch(e) {
    console.error("Waiting for sources API...")
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)).then( async () => {
        sources = await getAPI({app: app},"sources",filters);
      })
    }
    catch(e) {
      console.error("Error loading sources API.")
      throw(e)
    }
  }
  app.locals[namespace] = sources;
}

async function feed_cache(app,namespace) {
  let feed;
  try {
    feed = await getFeed();
  }
  catch(e) {
    throw(e)
  }
  app.locals[namespace] = feed;
}

async function toloco_get_data(app,namespace) {
  let data = {}

  for (f in constants.toloco_files) {
    console.log("Reading toloco",constants.toloco_files[f]);
    const fileIndex = constants.toloco_files[f].substr(0,constants.toloco_files[f].indexOf("."));
    const fileContents = fs.readFileSync(constants.toloco_files_path+constants.toloco_files[f], 'utf8');
    try {
      const obj = JSON.parse(fileContents);
      data[fileIndex] = obj.data || obj;
    }
    catch(e) {
      try {
        // console.log("Error JSON 1",files[f]);
        const jsonLinesContents = ('['+fileContents.replace(/\n/g,",")+"]").replace(",]","]").replace(/NaN/g,"null");
        const obj = JSON.parse(jsonLinesContents);
        data[fileIndex] = obj;
      }
      catch(e) {
        try {
          // console.log("Error JSON 2",files[f]);
          const numberContents = ('{"value": "'+fileContents+'"}');
          const obj = JSON.parse(numberContents);
          data[fileIndex] = obj;
        }
        catch(e) {
          console.error("Reading error",constants.toloco_files[f],e);
          console.log(fileContents);
        }
      }
    }

    //Invert bottom order
    if (fileIndex.indexOf("bottom") > -1 && data[fileIndex].reverse) {
      data[fileIndex] = data[fileIndex].reverse();
    }
  }

  app.locals[namespace] = data;

  // console.log(data);

  // return data;
}

// Download a file from URL to local config folder
function downloadConfigFile(CSVurl, localPath) {
  return new Promise((resolve, reject) => {
    // Ensure config directory exists
    const configDir = path.dirname(localPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    let responseData = Buffer.alloc(0);

    try {
      const req = https.get(CSVurl, response => {
        // Handle redirects (303 status)
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            req.destroy();
            return downloadConfigFile(redirectUrl, localPath).then(resolve).catch(reject);
          }
        }

        if (response.statusCode !== 200) {
          console.log(`GET ${CSVurl} - ${response.statusCode}`);
        }
        
        response.on("data", function(data) {
          responseData = Buffer.concat([responseData, data]);
        });
        
        response.on("end", function() {
          try {
            fs.writeFileSync(localPath, responseData);
            console.log(`Downloaded config file to ${localPath}`);
            resolve();
          } catch (writeError) {
            console.error(`Error writing config file ${localPath}:`, writeError);
            reject(writeError);
          }
        });
        
        response.on("error", function(error) {
          console.error(`Download response error for ${CSVurl}:`, error);
          reject(error);
        });
      });
      
      req.on("error", function(error) {
        console.error(`Download request error for ${CSVurl}:`, error);
        reject(error);
      });
      
      // Add timeout
      req.setTimeout(10000, function() {
        console.error(`Download timeout for ${CSVurl} after 10s`);
        req.destroy();
        reject(new Error('Download timeout'));
      });
    }
    catch (e) {
      console.error(`Download exception for ${CSVurl}:`, e);
      reject(e);
    }
  });
}

// Get settings from csv and set to app.locals.
// Parameters:
// - namespace: string, representing the name of the property used to store the values of this CSV file
// - CSVurl: URL from which to retrieve the CSV file (used for downloading if local file doesn't exist)
// - fields: array with column names for the CSV, each line in the CSV will be an object in an array of values. First field is the index.
function appLocalsFromCSV(app,namespace,CSVurl,fields,callback) {

  return new Promise(async (resolve,reject) => {

    if (!CSVurl) {
      console.error("appLocalsFromCSV error: Missing CSVurl for namespace",namespace);
      app.locals[namespace] = {};
      resolve(); // Resolve with empty data instead of rejecting
      return;
    }

    //Create the namespace object
    app.locals[namespace] = {};

    // Determine local file path
    const configDir = path.join(process.cwd(), 'config');
    const localPath = path.join(configDir, `${namespace}.csv`);

    try {
      // Check if local file exists, if not download it
      if (!fs.existsSync(localPath)) {
        console.log(`Local config file not found for ${namespace}, downloading from ${CSVurl}...`);
        try {
          await downloadConfigFile(CSVurl, localPath);
        } catch (downloadError) {
          console.error(`Failed to download config file for ${namespace}:`, downloadError);
          // Continue with empty data if download fails
          resolve();
          return;
        }
      }

      // Read from local file
      let fileData;
      try {
        fileData = fs.readFileSync(localPath);
      } catch (readError) {
        console.error(`Error reading local config file ${localPath}:`, readError);
        app.locals[namespace] = {};
        resolve();
        return;
      }

      // Parse CSV
      let parsedCSV;
      try {
        parsedCSV = csv.parse(fileData);
      } catch(csvError) {
        console.warn(`CSV parsing failed for ${namespace}: ${csvError.message}. Using empty data.`);
        parsedCSV = [];
      }

      // Process CSV data
      for(line in parsedCSV) {
        //Only parse lines with a first value present, and ignore the first one
        if (line > 0 && parsedCSV[line][0]) {

          //Create values object for this line
          const values = {}
          let id;

          //Iterate each field
          for (f in fields) {
            //Only parse existent values
            if (parsedCSV[line][f]) {
              //First field is the id
              if (f==0) {
                id = parsedCSV[line][f];
              }
              //All other fields are part of the values object
              else {
                values[fields[f]] = parsedCSV[line][f];
              }
            }
            else {
              console.error("appLocalsFromCSV","Field '",f,fields[f],"' not present in CSV line",line,"when loading",namespace,"from",localPath);
            }
          }
          //Add the values object to the array for this id
          if (!app.locals[namespace][id]) { app.locals[namespace][id] = [] }
          app.locals[namespace][id].push(values);
        }
      }
      console.log("Loaded config", namespace)
      resolve();
    }
    catch (e) {
      console.error(`appLocalsFromCSV exception for ${namespace}:`, e);
      app.locals[namespace] = {};
      resolve(); // Resolve with empty data instead of rejecting
    }
  });
}

function cleanURL(url) {
  if (url.indexOf("?") == -1) {
    url+="?";
  }
  return url.replace(/&page=[0-9]+/,"");
}

// Feed Home
async function getFeed() {
  let parser = new Parser({
    timeout: 3000, //in ms, down from default 60 seconds
    customFields: {
      item: [
        ['enclosure', 'enclosures', {keepArray: true}],
        ['media',"media"],
        ['media:content',"media"],
      ]
    }
  });

  if(!process.env.FEED_URL) {
      console.log("No feed");
      return [];
  }
  
  let feed;
  try {
    feed = await parser.parseURL(process.env.FEED_URL);
  }
  catch (e) {
    console.warn(`RSS parsing failed for ${process.env.FEED_URL}: ${e.message}. Using empty feed.`);
    return [];
  }
  console.log("getFeed",process.env.FEED_URL);
  return feed.items.slice(0,3);
}

// API
async function getAPI(req,collection,filters,debug) {
  var client = new Qqw({rest_base: process.env.API_BASE});

  var params = []; //params recibe fields para filtrar los campos que envia y text que no se que es

  if (collection=="contracts") {
    //Contract search with title do not sort -- because of mongo memory restrictions
    //ContactPoint Filter does not sort either
    // console.log("getAPI filters",filters);

    //Only hide hidden contracts when there's no other filter
    if (Object.keys(filters).length<1) {
      filters.hidden="false";
    }
  }


  //We use the autocomplete endpoint to search in all collections
  if (collection=="all") {
    collection = "search"
  }

  for (f in filters) {
    //Delete collection filter from api requests, pass the rest
    // if (f != "_collection") {
      params[f] = filters[f];
    // }
  }

  if (debug) {
    params.debug="true";
    console.log("getApi",collection,params);
  }


  let result = await client.get_promise(collection, params);

  if (result.error) {
    err = new Error();
    err.name = "API response error: "+result.error.message;
    err.message = result.error.location;
    err.status=500;
    throw(result.error);
  }
  // console.log("result",result);
  return result.data;
}

// Contact and Send Information Form - Redirects to external contact page

let db_prefix = "";

//This function gets the filters from config and query to send to the api
function getFilters(query, collection, defaultFilters, debug) {
  // console.log("getFilters 1", collection, query, defaultFilters);
  let filters = cloneDeep(defaultFilters) || {};

  for (filterElement in constants.filter_elements) {
    // console.log("getFilters 2",constants.filter_elements[filterElement].htmlFieldName,query[constants.filter_elements[filterElement].htmlFieldName],constants.filter_elements[filterElement].collections);
    let filter = cloneDeep(constants.filter_elements[filterElement]);

    // console.log(filter.default,filter.default === debug.undefined, filter)
    let queryValue = query[filter.htmlFieldName] || query[filter.htmlFieldName+"-min"] || query[filter.htmlFieldName+"-max"];

    //Ignore undefined values
    if (queryValue == "undefined") { queryValue = "" }


    //Add default value if it exists
    if (!queryValue && filter.default) {
      queryValue = filter.default.value;
    }

    //Check if this filter applies for this collection
    filter.applies = false;
    // console.log(filter);
    if (filter.collections.indexOf(collection) > -1 || filter.collections.indexOf("all") > -1  || (collection == "all" && filter.collections.indexOf("all-only") > -1) ) {
      filter.applies = true;

      //Dependent filters
      if (filter.show_if) {
        //Filters with values should always apply
        if (filters[filter.show_if] || queryValue) {
          filter.applies = true;
        }
        else {
          filter.applies = false;
        }
      }
    }

    // console.log(collection,filter.collections,filter.applies)

  	if (queryValue && filter.applies) {
      const apiFieldName = filter.apiFilterName
      //TODO: This throws an error is an URL parameter is set more than once
      let value = encodeURIComponent(decodeURIComponent(queryValue.trim()));
      // console.log("queryValue",typeof queryValue, queryValue, value);

      if (filter.type == "minmax") {
        if (query[filter.htmlFieldName+"-min"]) {
          filters[filter.apiFilterName.min] = encodeURIComponent((query[filter.htmlFieldName+"-min"] || "").replace(/[\.\,\ ]/g,""));
        }
        if (query[filter.htmlFieldName+"-max"]) {
          filters[filter.apiFilterName.max] = encodeURIComponent((query[filter.htmlFieldName+"-max"] || "").replace(/[\.\,\ ]/g,""));
        }
      }
      if (filter.type == "date") {
        filters[filter.apiFilterName.min] = (query[filter.htmlFieldName+"-min"] || "1900-01-01").trim();
        filters[filter.apiFilterName.max] = (query[filter.htmlFieldName+"-max"] || "9999-12-31").trim();
        // console.log("getFilters date",min,max);
      }

      //Calculate offset
      if (apiFieldName == "offset") {
        //Get page size from query string
        let pageSize = parseInt(query["size"]) || 25;

        //Multiply offset value by page size
        value = value*pageSize;

        if (value+pageSize > 10000) {
          filters.error = "morethan10k"
        }
      }

      if (value && typeof apiFieldName == "string") {
        filters[apiFieldName] = value;
      }
      // console.log("getFilters 1",filter.htmlFieldName,filter.applies);

  	}
  }

  //Ask the API for a different database (for development)
  if (query.alternate) {
    db_prefix = "cr_";
  }

  //TODO: Remove
  filters["db_prefix"] = db_prefix;

  // console.log("getFilters",filters);
  return filters;
}

//TODO: Cache requests
async function initAPIFilter(filter, filters, res, req, debug) {
  //Avoid modifying api request filters for global filter
  localFilter = cloneDeep(filter);
  if (debug) {
    console.log("initAPIFilter",localFilter);
  }

  //Replace templates in api request filters
  if (localFilter.api_request.filters) {
    Object.keys(localFilter.api_request.filters).map(  f => { if (localFilter.api_request.filters[f].indexOf && localFilter.api_request.filters[f].indexOf("#ref/") == 0 ) { localFilter.api_request.filters[f] = filters[localFilter.api_request.filters[f].substring(5)] } } )
  }

  //Get data from api
  rawOptions = await getAPI(req,localFilter.api_request.collection,localFilter.api_request.filters,debug);

  if (rawOptions.data.length > 1) {
    //Apply data from api to global filter
    rawOptions.data.map(option => { filter.options[option.id] = helpers._(helpers.translate_area(option.name),res.locals.lang) })
  }
  else {
    //If no data returned, hide filter
    filter.applies=false;
  }

  return filter;
}

//This function cleans the filters befor sending them to the template
async function cleanFilters(filters, collection, res, req, debug) {
  const allFilters = cloneDeep(constants.filter_elements);
  // console.log("allFilters",allFilters);
  let cleanFilters = [];

  for (filterElement in allFilters) {
    let filter = cloneDeep(allFilters[filterElement]);

    // console.log("cleanFilters",filter,filterElement);
    //Check if this filter applies for this collection
    filter.applies = false;
    if (filter.collections.indexOf(collection) > -1 || filter.collections.indexOf("all") > -1  || (collection == "all" && filter.collections.indexOf("all-only") > -1) ) {
      filter.applies = true;

      //Dependent filters
      if (filter.show_if) {
        if (filters[filter.show_if] || filters[filter.apiFilterName]) {
          filter.applies = true;
        }
        else {
          filter.applies = false;
        }
      }

      // console.log("cleanFilters",filter.api," filter.apiFilterName",filter.apiFilterName,"filters[filter.apiFilterName]",filters[filter.apiFilterName],"applies", filter.applies,"filter.show_if",filter.show_if,"filters[filter.show_if]",filters[filter.show_if])
    }

    // console.log(collection,filter.collections,filter.applies)
    //Only process filters for the current collection
    if (!filter.applies) {
      continue;
    }


    //API query filters
    if (filter.api_request) {
      filter = await initAPIFilter(filter, filters, res, req, debug);
    }


    let value;

    //Convert offset to page
    if (filter.apiFilterName == "offset") {
      //Get pagesize from filter
      let pageSize = parseInt(filters["limit"]) || 25;

      //Divide value of offset by page size
      value = parseInt(filters[filter.apiFilterName])/pageSize;
    }

    else if (filter.type=="date") {
      if (filters[filter.apiFilterName.min] || filters[filter.apiFilterName.max]) {
        value = {}
        if (filters[filter.apiFilterName.min]) {
          value.min = moment(filters[filter.apiFilterName.min]).format("YYYY-MM-DD")
        }
        if (filters[filter.apiFilterName.max]) {
          value.max = moment(filters[filter.apiFilterName.max]).format("YYYY-MM-DD")
        }

      }
    }
    else if (filter.type=="minmax") {
      // console.log(filter.apiFilterName.min,filters);
      if (filters[filter.apiFilterName.min] || filters[filter.apiFilterName.max]) {
        value = {}
        if (filters[filter.apiFilterName.min]) {
          value.min = decodeURIComponent(decodeURIComponent(filters[filter.apiFilterName.min]));
        }
        if (filters[filter.apiFilterName.max]) {
          value.max = decodeURIComponent(decodeURIComponent(filters[filter.apiFilterName.max]));
        }

      }
    }
    else {
      value = filters[filter.apiFilterName];
    }

    if (typeof value == "string" ) {
      value = decodeURIComponent(decodeURIComponent(value));
    }

    if (filter.type == "bool" && filters.hasOwnProperty(filter.apiFilterName)) {
      value = value ? false : true;
    }

    if (value) {
      filter.value = value;
    }


    cleanFilters.push(filter);
  }

  if (debug) {
    console.log("cleanFilters",cleanFilters);
  }
  return cleanFilters;
}

function getCollection(query) {
  return query.collection || "all";
}


function searchPage2020(defaultFilters, templateName) {
  return catchError(async function(req, res, next) {
    let moreThan10k = false;
    let processedResult = {};
    let pagesArray = [1]

    setCache(res);

    //Set language for this response
    res.locals.lang = req.params.lang;

    const collection = getCollection(req.query);

    const current_page = parseInt(req.query.page) || 0;
    const debug = req.query.debug || false;

    const filters = getFilters(req.query, collection, defaultFilters, debug);

    if (!filters.error) {

      //If collection is all or not defined, ask for default results
      if (collection == "all" || !collection) {
        const buscadores = res.app.locals.buscadores[collection] || [];
        filters.ids = buscadores.map((item) => { return item.id.trim() }).join(",")
      }

      const result = await getAPI(req, collection, filters, debug);

      //Check if search has more than 10000 results because of api limits
      if (result.count == 10000 && result.count_precission == "gte") {
        moreThan10k = true;
      }

      pagesArray = calculatePages(result.pages,current_page,moreThan10k);

      // TODO: Page size
      // filters.offset = current_page * 25;

      processedResult = result

      if (debug) {
        console.log("searchPage processedResult",processedResult);
      }
    }
    else if (filters.error == "morethan10k") {
      moreThan10k = true;
      processedResult = {count: 10000, count_precission: "gte"}
      pagesArray = calculatePages(0,current_page,moreThan10k);

    }


    // console.log("searchPage2020",filters._collection)
    const filters_cleaned = await cleanFilters(filters, collection, res, req, debug);

    const title = generateSearchTitle(filters_cleaned,res);

    const share_url = req.originalUrl;
    const share_url_encoded = encodeURIComponent(req.originalUrl);
    const current_url = cleanURL(req.originalUrl.replace(/\&\&/g,"&"));

    res.render("searcher", {
      collection: collection,
      result: processedResult,
      share_url: share_url,
      share_url_encoded: share_url_encoded,
      title: title,
      pagesArray:pagesArray,
      current_url: current_url,
      current_page: current_page,
      filters: filters_cleaned,
      templateName: "searcher",
      morethan10k: moreThan10k,
      current_url: req.originalUrl
    });
  })
}

function generateSearchTitle(filters,res) {
  let title = {
    brand:  helpers._("QuiénEsQuién.Wiki",res.locals.lang),
    filters: []
  }

  for (f in filters) {
    let filter = filters[f]
    if (filter.apiFilterName == "collection") {
      if (filter.value) {
        title.collection_short = helpers.get_type_plural(filter.value,true,res.locals.lang);
        title.collection = helpers.get_type_plural(filter.value,false,res.locals.lang);
      }
      else {
        title.collection_short = helpers._("Todas",res.locals.lang);
        title.collection = helpers._("Todas",res.locals.lang);
      }
    }
    else {
      let filterValue;
      if (!filter.hidden) {
        switch (filter.type) {
          case "select":
            //Uninitialized api filters can have a missing options field
            // console.log(filter);
            if (filter.options && filter.value) {
              if (filter.apiFilterName !== "sort") {
                filterValue = filter.options[filter.value] ;
              }
            }
            break;
          case "date":
          case "minmax":
            // console.log("generateSearchTitle",filter.fieldLabel,filter.value);
            filterValue = (filter.value ? filter.value.min+" a "+filter.value.max : filter.default.value);
            break;
          case "toggle":
            break;
          default:
            filterValue = filter.value || filter.default.value;
            break;
        }
      }
      if (filterValue) {
        title.filters.push(filter.fieldLabel + ": " + filterValue);
      }
  }
    // console.log("generateSearchTitle",filters[f]);
  }
  title.full = title.collection_short + (title.filters.length ? " - " + title.filters.join(" - ")  : "") + " - " +  title.brand;
  return title;
}

function calculatePages(pages_count,current_page,moreThan10k) {
	pagesArray = [];

	//If we're more than 4 pages away, add link to first page
	if (current_page > 3) {
		pagesArray.push({ type: "first", value: 0, enabled: true, title: "<< Primera" })
	}

  // Link previous page if we're not in first page
	pagesArray.push({ type: "prev", value: current_page-1, enabled: (current_page != 0), title: "< Anterior" })


	for (page=0; page < pages_count; page++) {
		//If we're more than 10 pages away, add link previous 10 pages
		if (page == current_page-10) {
			pagesArray.push({ type: "prev10", value: page, enabled: true,  title: page+1 })
		}

		//If we're more than 5 pages away, add link previous 5 pages
		if (page == current_page-5) {
			pagesArray.push({ type: "prev5", value: page, enabled: true, title: page+1 })
		}

		//If we're more than 3 pages away, add link to all pages
		if (page > (current_page-3) && page < (current_page+3) ) {
			//Current is disabled
			if (page == current_page) {
				pagesArray.push({ type: "current", value: current_page, enabled: false, title: current_page+1 })
			}
			else {
				pagesArray.push({ type: "page", value: page, enabled: true, title: page+1 })
			}
		}
		//If we have more than 5 pages to go, add link next 5 pages
		if (page == current_page+5) {
			pagesArray.push({ type: "next5", value: page, enabled: true, title: page+1 })
		}
		//If we have more than 10 pages to go, add link next 10 pages
		if (page == current_page+10) {
			pagesArray.push({ type: "next10", value: page, enabled: true, title: page+1 })
		}
	}

  //Next page is linked if we're not at last page
  pagesArray.push({ type: "next", value: current_page+1, enabled: (current_page < (pages_count-1)), title: "Siguiente >" })

  //If we are not at the last page, add link to last page
  //on searches with less than 10.000 results (because of the API limtis)
	if (current_page != (pages_count-1) && !moreThan10k) {
		pagesArray.push({ type: "last", value: (pages_count-1), enabled: true, title: "Última >>" })


  }

	return pagesArray;
}

function entityPage(collection,templateName,idFieldName) {
  return catchError(async function(req, res, next) {
    // console.log("entityPage",collection,templateName,idFieldName,req,res,next);
    setCache(res);

    //Set language for this response
    res.locals.lang = req.params.lang;

    let filters = {
      limit: 1,
      sort: null,
      embed: true
    };

    //TODO: Remove
    filters["db_prefix"] = db_prefix;
        
    const flag_count = req.query.flag_count || 3;
    const debug = req.query.debug || false;
    filters[idFieldName] = req.params.id;

    if (collection == "countries" && templateName != "country-mujeres") {
      filters["embed"] = false;
    }

    const result = await getAPI(req,collection,filters,debug);
    if (!result || !result.data || !result.data[0]) {
      let err = new Error("entityPage: Entity not found: "+collection+" "+req.params.id);
      err.status = 404;
      throw(err);
    }
    if (result.data.indexOf("error") == 0) {
      let err = new Error("entityPage: Database errror: "+collection+" "+req.params.id+"\n"+result.data);
      err.status = 500;
      throw(err);
    }

    //Todo: Paralellize
    let summaries = {};
    if (collection != "contracts" && collection != "record") {
      summaries = await getAPI(req,"summaries",filters,debug);
    }

    const share_url = req.originalUrl;
    const share_url_encoded = encodeURIComponent(req.originalUrl);

    let metaTitle = "";

    metaTitle += result.data[0].name || result.data[0].title || (result.data[0].records ? result.data[0].records.compiledRelease.contracts.title : result.data[0].contracts ? result.data[0].contracts.title : "Sin título");
    metaTitle += " - ";
    metaTitle += helpers.get_classification_name(collection,result.data[0].classification,result.data[0].subclassification,result.data[0].govLevel,res.locals.lang);
    metaTitle += " - ";
    metaTitle += helpers._("QuienEsQuien.wiki",res.locals.lang);

    let processedResult = {};

    if (collection == "record" || collection=="contracts" ) {
      processedResult = result.data[0];

      if (collection == "record") {
        //Sort awards
        processedResult.records.compiledRelease.awards = sortBy(processedResult.records.compiledRelease.awards,["value.amount"]).reverse()
        // console.log(processedResult.records.compiledRelease.awards);
      }
    }
    else {
      processedResult = fixMemberships(result.data[0])
    }
    processedResult.api_url = result.api_url;
    if (summaries) {
      processedResult.api_summary_url = summaries.api_url;
    }

    // console.log(processedResult);

    res.render(templateName, {
      result: processedResult,
      summaries: summaries,
      type: collection,
      flag_count: flag_count,
      title: metaTitle,
      share_url: share_url,
      share_url_encoded: share_url_encoded,
      current_url: req.originalUrl
    });
  })
}

function fixMemberships(result) {
  if (result.memberships) {
    const memberships = {};
    // console.log("fixMemberships",allMemberships,allMemberships.length);
    if (result.memberships.length > 0) {
      for (m in result.memberships) {
        let role = result.memberships[m].role;
        let direction = result.memberships[m].direction;

        if (!memberships[direction]) {
          memberships[direction] = {}
        }

        if (!memberships[direction][role]) {
          memberships[direction][role] = {
            role: role,
            direction: direction,
            memberships: []
          }
        }
        memberships[direction][role].memberships.push(result.memberships[m]);
        //Sort memberships by name
        memberships[direction][role].memberships = sortBy(memberships[direction][role].memberships,["organization_name", "person_name", "parent_name"]);
      }

      result.memberships = memberships;
    }

    // if (result.memberships["Unidad Compradora"]) {
    //   result.membership_uc_ = result.memberships["Unidad Compradora"];
    //   delete result.memberships.parent["Unidad Compradora"];
    // }

    // console.log("fixMemberships RR",result.memberships);
  }
  return result;
}

function redirectToSite() {
  return catchError(async function(req, res, next) {
    const xForwardedHost = req.headers["x-forwarded-host"];
    const hostHeader = req.headers.host;
    const originalHost = xForwardedHost || hostHeader;
    
    console.log("=== redirectToSite DEBUG ===");
    console.log("x-forwarded-host:", xForwardedHost);
    console.log("host header:", hostHeader);
    console.log("originalHost:", originalHost);
    console.log("req.url:", req.url);
    console.log("req.originalUrl:", req.originalUrl);
    
    // Extract sitename: get host, remove port, then get first part before dot
    const host = (originalHost || "").split(":")[0].toLowerCase().trim();
    console.log("host (after port removal and lowercasing):", host);
    
    // Validate host is not empty
    if (!host || host === "") {
      console.log("ERROR: Empty host, falling back to /inicio");
      return redirectToLanguage("/inicio","/home")(req, res, next);
    }
    
    // CRITICAL: Store the original host in the request object so redirectToLanguage can use it
    // This prevents issues where headers might be modified by proxies/CDNs
    req.originalRequestHost = host;
    
    // Handle subdomains like "todosloscontratos.sociedad.info" or "todosloscontratos"
    // Split by dot and take the first part as sitename
    const hostParts = host.split(".");
    let sitename = hostParts[0].toLowerCase().trim();
    
    console.log("hostParts:", hostParts);
    console.log("sitename extracted:", sitename);
    
    // Special handling: "quienesquien", "quienesquienwiki", and "qqw" are the main site
    // They should go to /inicio (home page) - NOT to any specific site
    const mainSiteNames = ["quienesquien", "quienesquienwiki", "qqw"];
    if (mainSiteNames.includes(sitename)) {
      console.log("Main site detected:", sitename);
      console.log("Redirecting to default /inicio / /home (main site, not a sub-site)");
      return redirectToLanguage("/inicio","/home")(req, res, next);
    }
    
    console.log("Available sites in qqw_sites:", Object.keys(constants.qqw_sites));
    
    // Only match exact sitename in qqw_sites (no substring matching)
    if (constants.qqw_sites && constants.qqw_sites[sitename]) {
      const siteConfig = constants.qqw_sites[sitename];
      console.log("MATCHED site:", sitename);
      console.log("Site config:", JSON.stringify(siteConfig));
      console.log("Redirecting to ES:", siteConfig["es"], "EN:", siteConfig["en"]);
      return redirectToLanguage(siteConfig["es"], siteConfig["en"])(req, res, next);
    }
    else {
      console.log("NO MATCH for sitename:", sitename);
      console.log("Falling back to default /inicio / /home");
      return redirectToLanguage("/inicio","/home")(req, res, next);
    }
  });
}

function redirectToSearch(page) {
  return catchError(async function(req, res, next) {
    //Detect current lang is pointless here, this code only executes when there's no lang in url
    let current_lang = req.params.lang || (req.app.locals.general.current_lang ? req.app.locals.general.current_lang[0][helpers.env()] : "es");

    // Get base path for subfolder hosting support
    // Use req.baseUrl if available (set by Express when router is mounted), otherwise use app.locals.basePath
    const basePath = req.baseUrl || req.app.locals.basePath || "";
    
    console.log("redirectToSearch DEBUG - req.url:", req.url, "req.originalUrl:", req.originalUrl, "req.baseUrl:", req.baseUrl, "basePath:", basePath);

    const newURL = req.originalUrl
        //Redirect to search
        .replace(/\/contratos(\/$|$|\?)/,"/buscador/?collection=contracts&").replace("&?","&")
        .replace(/\/personas(\/$|$|\?)/,"/buscador/?collection=persons&").replace("&?","&")
        .replace(/\/empresas(\/$|$|\?)/,"/buscador/?collection=companies&").replace("&?","&")
        .replace(/\/instituciones-publicas(\/$|$|\?)/,"/buscador/?collection=institutions&subtipo-entidad=dependencia&").replace("&?","&")
        .replace(/\/unidades-compradoras(\/$|$|\?)/,"/buscador/?collection=institutions&subtipo-entidad=unidad-compradora&").replace("&?","&")
        .replace(/\/paises(\/$|$|\?)/,"/buscador/?collection=countries&").replace("&?","&")
    
        //Redirect to profile
        .replace(/\/contratos\/([^?]+)/,"/"+current_lang+"/expediente/$1")
        .replace(/\/paises\/([^?]+)/,"/"+current_lang+"/areas/$1")
        .replace(/\/empresas\/([^?]+)/,"/"+current_lang+"/empresas/$1")
        .replace(/\/personas\/([^?]+)/,"/"+current_lang+"/personas/$1")
        .replace(/\/instituciones-publicas\/([^?]+)/,"/"+current_lang+"/instituciones-publicas/$1")

    // Prepend base path to the new URL
    const finalURL = basePath + newURL;

    console.log("redirectToSearch",req.originalUrl,newURL,finalURL);
    if (req.originalUrl == finalURL) {
      throw("Failed redirect");
    }

    return res.redirect(finalURL);
  });
}

function redirectToLanguage(es,en) {
  return catchError(async function(req, res, next) {

    //Detect current lang is pointless here, this code only executes when there's no lang in url
    const envValue = helpers.env();
    const generalExists = !!req.app.locals.general;
    const currentLangFromGeneral = generalExists && req.app.locals.general.current_lang ? req.app.locals.general.current_lang[0][envValue] : null;
    let current_lang = req.params.lang || currentLangFromGeneral || "es";
    let current_url = req.url ;

    //Fix for home
    if (current_url == "/") {
      current_url = es;
    }

    // Get base path for subfolder hosting support
    // Priority: req.detectedBasePath (from middleware) > req.baseUrl (Express) > res.locals.basePath > app.locals.basePath
    const basePath = req.detectedBasePath || req.baseUrl || (res && res.locals && res.locals.basePath) || req.app.locals.basePath || "";

    console.log("redirectToLanguage DEBUG - req.url:", req.url, "req.originalUrl:", req.originalUrl, "req.baseUrl:", req.baseUrl, "req.detectedBasePath:", req.detectedBasePath, "basePath:", basePath, "current_url:", current_url);

    let newURL = "";
    // Ensure current_lang is a valid string and normalize it
    if (typeof current_lang === 'string' && current_lang.trim() === "es") {
      newURL = "/es"+current_url;
    } else if (typeof current_lang === 'string' && current_lang.trim() === "en") {
      newURL = "/en"+current_url.replace(es,en);
    } else {
      // Default to "es" if language detection failed
      newURL = "/es"+current_url;
    }

    console.log("redirectToLanguage - newURL before basePath:", newURL);

    if (!newURL || newURL === "") {
      newURL = "/es/inicio"; // Fallback
    }

    // Prepend base path to the new URL
    const finalURL = basePath + newURL;

    // Use absolute URL for redirect to ensure it works through proxies/CDNs
    // Check x-forwarded-proto first (for Cloudflare/proxies), then req.protocol, default to https for production
    let protocol = 'https'; // Default to https for security
    if (req.headers['x-forwarded-proto']) {
      const forwardedProto = req.headers['x-forwarded-proto'].split(',')[0].trim();
      if (forwardedProto) protocol = forwardedProto;
    } else if (req.protocol && req.protocol !== 'http' && req.protocol !== 'https') {
      // Only use req.protocol if it's a valid protocol
      protocol = req.protocol;
    } else if (req.secure || req.headers['x-forwarded-ssl'] === 'on') {
      protocol = 'https';
    } else if (helpers.env() === 'development') {
      protocol = 'http'; // Only use http in development
    }
    
    // Get host - prefer stored original host from redirectToSite, then headers, then fallback
    // This ensures we use the correct host even if proxies/CDNs modify headers
    let host = req.originalRequestHost || req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    host = host.split(':')[0].toLowerCase().trim(); // Remove port if present
    
    // Log for debugging
    console.log('redirectToLanguage - host:', host, 'originalRequestHost:', req.originalRequestHost, 'x-forwarded-host:', req.headers['x-forwarded-host'], 'host header:', req.headers.host);
    
    // Validate host is from sociedad.info domain (security check)
    if (!host.includes('sociedad.info') && !host.includes('localhost') && helpers.env() !== 'development') {
      console.log('WARNING: Unexpected host detected:', host);
    }
    
    const absoluteURL = `${protocol}://${host}${finalURL}`;
    console.log('redirectToLanguage - finalURL:', finalURL, 'absoluteURL:', absoluteURL);
    
    // Manually set Location header and status to ensure it's not stripped by proxies
    if (!res.headersSent) {
      console.log('Redirecting to: ' + absoluteURL, "from" ,current_url, "basePath:", basePath);
      res.status(302);
      res.setHeader('Location', absoluteURL);
      res.location(absoluteURL);
      return res.send('Redirecting to <a href="' + absoluteURL + '">' + absoluteURL + '</a>');
    }
  });
}

function setCache(res) {
  //TODO: Don't cache on debug
  res.cacheControl = {
    maxAge: (helpers.env() == "staging" ? 0 : 600),
    public: true
  };
}

function homePage() {
  return catchError(async function(req, res, next) {
    let feed, stats, alert;
    console.log("homePage",req.params.lang);

    setCache(res);

    //Set language for this response
    res.locals.lang = req.params.lang;


    const debug = req.query.debug || false;

    // Always render home even without API
    try {
      // console.log("homePage sources",req.app.locals.sources);
      // console.log("homePage feed",req.app.locals.feed);
      stats = req.app.locals.sources.data;
    }
    catch(e) {
      alert = "No se pudieron recuperar algunas fuentes de datos, por favor contáctenos si este error le afecta.";
      console.error("QQW HOME API Error",e);

      //Avoid caching home on error
      res.cacheControl = {
        noStore: true
      }

    }

    const share_url = req.originalUrl;

    const feed_basado = constants.feed_basado;

    res.render('home', {
      feed_rindecuentas: req.app.locals.feed,
      feed_basado: feed_basado,
      home: true,
      stats:stats,
      alert: alert,
      title: helpers._("QuiénEsQuién.Wiki",res.locals.lang),
      share_url: share_url,
      autocomplete_ids: (res.app.locals.buscadores["all"] || []).map((item) => { return item.id.trim() }).join(","),
      current_url: req.originalUrl
    });
  })
}


function staticPage(templateName, layout = "layout") {
  return catchError(async function(req, res, next) {

    // Redirect contact page to external contact page
    if (templateName == "contact") {
      const params = new URLSearchParams();
      if (req.query.subject) params.append('subject', req.query.subject);
      if (req.query.email) params.append('email', req.query.email);
      if (req.query.name) params.append('name', req.query.name);
      if (req.query.message) params.append('message', req.query.message);
      if (req.query.referer) params.append('referer', req.query.referer);
      if (req.query.type) params.append('type', req.query.type);
      if (req.query.url) params.append('url', req.query.url);
      if (req.query.source) params.append('source', req.query.source);
      if (req.query.institution) params.append('institution', req.query.institution);
      
      const redirectUrl = `https://www.sociedad.info/contact?${params.toString()}`;
      return res.redirect(302, redirectUrl);
    }

    setCache(res);

    //Set language for this response
    res.locals.lang = req.params.lang;
    let metaTitle = []
    if (templateName == "about"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Sobre QQW",res.locals.lang) }
    if (templateName == "apis"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Herramientas",res.locals.lang) }
    if (templateName == "investigations"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Investigaciones",res.locals.lang) }
    if (templateName == "manual"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Manual",res.locals.lang) }
    if (templateName == "partners"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Aliados",res.locals.lang) }
    if (templateName == "privacy"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Privacidad",res.locals.lang) }
    if (templateName == "license"){ metaTitle = helpers._("QQW",res.locals.lang)+" - "+helpers._("Licencia",res.locals.lang) }
    
    // console.log(templateName,metaTitle,res.locals.lang);

    const share_url = req.originalUrl;
    const querySubject = req.query.subject;

   res.render(templateName , {
     currentSection: templateName,
     title: metaTitle,
     share_url: share_url,
     querySubject: querySubject,
     layout: layout,
     currentTemplate: "about",
     referer: req.get('Referer'),
     current_url: req.originalUrl,
     toloco_result: req.app.locals.toloco
    });
 })
}


function sourcesPage() {
  return catchError(async function(req, res, next) {
    let stats, alert, sources, response;

    setCache(res);

    //Set language for this response
    res.locals.lang = req.params.lang;

    // Always render sources even without API
    try {
      sources = req.app.locals.sources;
      stats = sources.data.collections;
      response = sources.data;
    }
    catch(e) {
      alert = "No se pudieron recuperar algunas fuentes de datos, por favor contáctenos si este error le afecta.";
      console.error("QQW Sources API Error",e);

      //Avoid caching home on error
      res.cacheControl = {
        noStore: true
      }

    }
    res.render('sources', {
      stats:stats,
      alert: alert,
      response: response,
      currentSection: "sources",
      title:helpers._("QQW")+" - "+helpers._("Entidades y fuentes"),
      current_url: req.originalUrl
    });
  })
}

function sendMailPage() {
  return function (req, res) {
    //Set language for this response
    res.locals.lang = req.params.lang;

    // Build query parameters for redirect
    const params = new URLSearchParams();
    
    if (req.body.email) params.append('email', req.body.email);
    if (req.body.name) params.append('name', req.body.name);
    if (req.body.subjectMail) params.append('subject', req.body.subjectMail);
    if (req.body.message) params.append('message', req.body.message);
    if (req.body.referer) params.append('referer', req.body.referer);
    if (req.body.type) params.append('type', req.body.type);
    if (req.body.url) params.append('url', req.body.url);
    if (req.body.source) params.append('source', req.body.source);
    if (req.body.institution) params.append('institution', req.body.institution);

    // Redirect to external contact page with parameters
    const redirectUrl = `https://www.sociedad.info/contact?${params.toString()}`;
    res.redirect(302, redirectUrl);
  }
}

module.exports = {
  searchPage2020:searchPage2020,
  redirectToSearch:redirectToSearch,
  redirectToLanguage:redirectToLanguage,
  homePage:homePage,
  sourcesPage:sourcesPage,
  entityPage:entityPage,
  staticPage:staticPage,
  sendMailPage:sendMailPage,
  loadSettings: loadSettings,
  reloadSettingsView: reloadSettingsView,
  redirectToSite: redirectToSite
  // saludPage: saludPage
}
