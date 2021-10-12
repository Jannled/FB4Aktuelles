const https = require('https');
const xml = require('fast-xml-parser');

/** Intervall in dem der RSS Feed auf Änderungen überprüft wird (in Sekunden) */
const updateInterval = 5;

/** Intervall in dem die Nachrichten an Discord übertragen werden. Verhindert Timeouts wenn beim Start oder wenn zu viele Nachrichten ins Aktuelle rein kommen */
const sendeInterval = 1;

/** RSS Feed, aus dem die Nachrichten gelesen werden. */
const rssFeed = 'https://gatekeeper-ng.informatik.fh-dortmund.de/aktuelles/aktuelles_feed';

/** Basis-URL welche für Links im Feed genutzt wird */
const baseUrl = 'https://gatekeeper-ng.informatik.fh-dortmund.de';

/** WebHook des Discord Servers */
var endpoint = 'https://discord.com/api/webhooks/892490556511518770/QKueTUIipcVlAAbV0XTox4u5wnOKh6OxWZFVhMncEgq7-7-FLHoCohYTIwBzzSJ1TyXA';
//              https://discord.com/api/webhooks/XXXXXXXXXXXXXXXXXX/YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY;

/** Warteschlange für den Sendevorgang */
var messageQueue = [];

/** Speichere gesendete Nachrichten, damit diese nicht doppelt gesendet werden und aktualisierungen erkannt werden können */
var messageStorage = [];

console.log(" ================================================= ");
console.log(" --- FH Dortmund FB4 Aktuelles Discord Newsbot --- ");
console.log(" ================================================= ");
console.log();

console.log("Config:");
console.log(" - Update Interval: " + updateInterval + "s");
console.log(" - Send Interval: " + sendeInterval + "s");
console.log(" - FH DO Aktuelles RSS: " + rssFeed)
console.log(" - RSS Basis URL: " + baseUrl)
console.log(" - Discord WebHook: " + endpoint.slice(0, 60) + '[...]');
console.log();

setInterval(() => holeFeed(rssFeed), updateInterval * 1000);
setInterval(sendeNachricht, sendeInterval * 1000);

var parser = new xml.j2xParser();

/**
 * Downloade den aktuellen RSS Feed der FH Dortmund und parse diesen
 * @param {string} url Adresse des RSS Feeds der FH Dortmund
 */
function holeFeed(url)
{
	// Lade RSS Feed von der FH runter
	let request = https.get(url, (res) => {
		const {statusCode} = res;

		const contentType = res.headers['content-type'];
		res.setEncoding('utf8');

		// Fange HTTP Fehler ab
		if(statusCode > 399)
			console.error(`Fehler ${statusCode} beim herunterladen vom RSS Feed`);

		// Fange unerwartete Dateitypen ab 'text/xml' 'application/rss+xml' 'application/atom+xml' 'application/rdf+xml' 'application/xml')
		if(!(contentType.match(/(text|application)\/((atom|rdf|rss)\+)?xml/)))
			console.error(`Unerwarteter Mime-Typ ${contentType} beim herunterladen vom RSS Feed`);

		let rawData = '';
		res.on('data', (chunk) => rawData += chunk);
		res.on('end', () => {
			try {
				let rss = xml.parse(rawData);
				parseFeed(rss)
			} catch (err) {
				console.error(err);
			}
		})
	});
}

/**
 * Sammle alle Infos für die Discord Nachrichten aus dem RSS Feed und packe diese in die Warteschlange zum Senden (wenn noch nicht vorhanden).
 * @param {JSON} data Der nach JSON gewandelte RSS Feed.
 */
function parseFeed(data)
{
	// Sammle Tokens für Discord aus dem RSS Feed
	bereitsEnthalten:
	for(let item of data.rss.channel.item)
	{
		let nachricht = {
			"embeds":  [{
				"title": item.title,
				"description": item.description,
				"timestamp": new Date(item.pubDate).toISOString(),
				"url": baseUrl + item.link,
				"footer": {
					"text": "Aktuelles" // Die Autor Info fehlt leider im RSS Feed, müsste die Manuell aus der verlinkten HTML ziehen...
				},
				"color": 16078080
			}]
		};

		// Konvertiere Paragraphen, Formatierungen etc. nach Markdown
		nachricht.embeds[0].title = htmlmd(nachricht.embeds[0].title);
		nachricht.embeds[0].description = htmlmd(nachricht.embeds[0].description);

		// Packe Nachricht in die Sende-Warteschlange
		var messageContainer = {
			"fhid": 0,
			"discordID": 0,
			"message": nachricht
		};
		messageContainer.fhid = Number(messageContainer.message.embeds[0].url.match(/([0-9]+$)/)[0]);

		// Durchsuche alle Nachrichten, ob die aktuelle bereits existiert
		for(let a of messageStorage)
		{
			if(a.fhid === messageContainer.fhid)
				break bereitsEnthalten;
		}
		for(let a of messageQueue)
		{
			if(a.fhid === messageContainer.fhid)
				break bereitsEnthalten;
		}
		messageQueue.push(messageContainer);
	}
}

/**
 * Sendet pro Aufruf eine Nachricht aus der Warteschlange an Discord
 * @returns Nothing
 */
function sendeNachricht()
{
	// Queue ist leer, nichts zu tun
	if(messageQueue.length < 1)
		return;	

	// Verwerfe alte Nachrichten damit der Speicher nicht voll läuft
	while(messageStorage.length > 100)
		messageStorage.shift();

	let messageContainer = messageQueue.shift();
	messageStorage.push(messageContainer);
	console.log(`Neue Nachricht (${messageContainer.fhid}) ${messageContainer.message.embeds[0].title}`);

	// Nachricht an Discord senden
	let msg = JSON.stringify(messageContainer.message);
	let req = https.request(endpoint + '?wait=true', {method: 'POST', headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(msg)}}, (res) => 
	{
		res.setEncoding('utf-8');

		let rawData = '';
		res.on('data', (chunk) => rawData += chunk);

		// Wenn Nachricht gesendet, packe Message handle von Discord dazu
		res.on('end', () => {
			try {
				let response = JSON.parse(rawData);
				messageContainer.discordID = response.id;
				console.log(`Nachricht (${messageContainer.fhid}) bestätigt: ${messageContainer.discordID}`);
			} catch (err) {
				console.error(err);
			}
		});
	});
	req.write(msg);
	req.end();
}

/**
 * Konvertiere HTML Tags nach Markdown
 * @param {string} text
 */
function htmlmd(text)
{
	if(!(typeof text === 'string' || text instanceof String))
	{
		console.error('HTML nach Markdown hat etwas anderes als nen String übergeben bekommen');
		return;
	}

	text = text.replace(/(<p.*?>)/g, '');
	text = text.replace(/(<\/p.*?>)/g, '\n');
	text = text.replace(/(<br *\/?.*?>)/g, '\n');
	text = text.replace(/(<\/?b.*?>)|(<\/?strong.*?>)/g, '**');
	text = text.replace(/(<\/?i.*?>)|(<\/?em.*?>)/g, '_');
	return text;
}