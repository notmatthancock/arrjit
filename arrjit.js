inlets = 1
outlets = 1

debug = 0
declareattribute('debug')

// debug freq is the maximum interval (in ms) between debug statements
var DEBUG_FREQ = 200

var MOVIE_EXTENSIONS = ['.mov', '.mp4']
var OBSERVED_CLIP_PROPS = ['end_time', 'loop_start', 'loop_end']

var song_api = null
var track_api = null
var clips = {}
var active_clip_id = null
var transport_is_playing = false
var videolist_is_playing = false
var is_stopped = true


function init(track_id) {
	track_api = null
  song_api = null
  clips = {}
	gc()

  post_debug('debug enabled')
	
	track_api = new LiveAPI(update_clips, 'id ' + track_id)
	track_api.property = 'arrangement_clips'

	song_api = new LiveAPI(transport_is_playing_changed, 'live_set')
  song_api.property = 'is_playing'

  send_stop_movie()
}

function transport_is_playing_changed(is_play) {
  if (song_api === null) return

  // update the global variable
  transport_is_playing = is_play[1]

  if (transport_is_playing && active_clip_id !== null) {
    // TODO: add frame number
    send_play_movie(active_clip_id)
  }
  else {
    send_stop_movie()
  }
}

// Does the given file path end with a movie file extension?
// Returns bool
clip_is_movie.local = 1
function clip_is_movie(file_path) {
  for (var j = 0; j < MOVIE_EXTENSIONS.length; j++) {
    var ext = MOVIE_EXTENSIONS[j]
    if (ends_with(file_path, ext)) {
      return true
    }
  }
  return false
}

// reimplemntation of String.endsWith
ends_with.local = 1
function ends_with(str, ext) {
  if (ext.length > str.length) return false

  var str = str.toLowerCase().split("").reverse()
  var ext = ext.toLowerCase().split("").reverse()

  for (var i = 0; i < ext.length; i++) {
    if (ext[i] != str[i]) return false
  }

  return true
}

// Called periodically to monitor if clip start times have changed.
// This a workaround for the inability to observe Clip.start_time.
function poll_clip_start_times() {
  for (var clip_id in clips) {
    var clip = new LiveAPI('id ' + clip_id)
    var start_time = clip.get('start_time')[0]
    if (start_time != clips[clip_id].start_time) {
      clips[clip_id].start_time = start_time
    }
  }
  gc()
}

// convert object to string for debugging
obj2str.local = 1
function obj2str(obj) {
  var result = "{"
  for (var key in obj) {
    var val = obj[key]
    result += "'" + key + "': " + obj[key] + ", "
  }
  return result + "}"
}

update_clips.local = 1
function update_clips(blerg) {
  for(var x in blerg) post_debug(x + ":" + blerg[x])
  if (track_api === null) return
  clips = {}
  gc()
  outlet(0, ['clear'])
	
	// get ids from API; the array looks like ['id', 9, 'id', 7, ...]
	var clip_ids = track_api.get('arrangement_clips')
  var count = 0

	for (var i = 0; i < Math.floor(clip_ids.length / 2); i++) {
    var start = Date.now()
    var clip_id = clip_ids[2*i+1]
    var playlist_index = i + 1
    var clip = new LiveAPI('id ' + clip_id)

    var file_path = clip.get('file_path')[0]
    if (!clip_is_movie(file_path)) continue

    // TODO: send message to UI element?
    // TODO: add observer for clip warping
    if (clip.get('warping')[0]) {
      post("warped movie clips not supported: " + file_path)
      continue
    }

    var start_marker = clip.get('start_marker')[0]
    var end_marker = clip.get('end_marker')[0]
    var start_time = clip.get('start_time')[0]
    var end_time = clip.get('end_time')[0]
    var loop_start = clip.get('loop_start')[0]
    var loop_end = clip.get('loop_end')[0]

    var clip_info = {
      'start_time': start_time,
      'start_marker': start_marker,
      'end_time': end_time,
      'end_marker': end_marker,
      'file_path': file_path,
      'playlist_index': playlist_index,
      'loop_start': loop_start,
      'loop_end': loop_end,
      'observers': []
    }

    var clip_length = loop_end - loop_start
    var start_selection = start_marker / clip_length
    var end_selection = end_marker / clip_length

    // Add the clip to the playlist
    outlet(0, ['append', file_path])
    post()
    post('time_spent = ' + (Date.now() - start))

    for (var j = 0; j < OBSERVED_CLIP_PROPS.length; j++) {
      var prop = OBSERVED_CLIP_PROPS[j]
      var api = new LiveAPI(
        function(msg) {
          update_clip_prop(msg, clip_id)
        },
        'id ' + clip_id
      )
      api.property = prop
      clip_info['observers'].push(api)
    }
    
    clips[clip_id] = clip_info
    count += 1
	}
	
  post_debug('there are ' + count + ' movie arrangement clips')
}

update_clip_prop.local = 1
function update_clip_prop(message, clip_id) {
  var prop = message[0]
  var value = message[1]
  var clip = clips[clip_id]
  clip[prop] = value
  update_clip_selections(clip.playlist_index, clip.clip_length)
  post_debug('updated ' + prop + ' to ' + value + ' for clip ' + clip_id)
  post_debug('clip_length', clip.clip_length)
}

// clip length is in milliseconds 
function update_clip_selections(playlist_index, clip_length) {
  var clip = null
  for (var clip_id in clips) {
    if (clips[clip_id].playlist_index == playlist_index) {
      clip = clips[clip_id]
      break
    }
  }
  if (clip === null) return

  // convert to seconds
  if (clip.clip_length === undefined) {
    clip_length /= 1000
    clip.clip_length = clip_length
  }
  else {
    clip_length = clip.clip_length
  }

  // var start_marker = clip.start_marker
  // var end_marker = clip.end_marker
  outlet(
    0, ['selection',
        playlist_index,
        clip.loop_start / clip_length,
        clip.loop_end / clip_length]
  )
}

function set_current_clip(ticks) {

	var curr_beats = ticks / 480

  for(var clip_id in clips) {
    var start_time = clips[clip_id].start_time
    var end_time = clips[clip_id].end_time

    //post_debug_limited((
    //  'id = ' + clip_id + '\n' +
    //  'curr = ' + curr_beats + '\n' +
    //  'start = ' + start_time + '\n' +
    //  'end = ' + end_time + '\n' +
    //  "play = " + active_clip_id
    //))

    if (
      curr_beats >= start_time &&
      curr_beats <= end_time
    ) {
      if (active_clip_id != clip_id) {
        send_play_movie(clip_id)
      }
      return
    }
  }
  send_stop_movie()
}

send_play_movie.local = 1
function send_play_movie(clip_id) {
  if (song_api === null) return

  if (transport_is_playing) {
    post_debug_limited("send_play_movie", clip_id)

    var index = clips[clip_id].playlist_index
    outlet(0, [index])

    active_clip_id = clip_id
    videolist_is_playing = true
  }
  else { // jump to frame, but don't play
    // TODO
  }
}

send_stop_movie.local = 1
function send_stop_movie() {
  // return if already stopped
  if (!videolist_is_playing) return
  post_debug("stop_movie")
  outlet(0, ['pause'])
  active_clip_id = null
  videolist_is_playing = false
}

function post_debug() {
  if (!debug) return
  if (arguments.length == 0) post()
  for (var i = 0; i < arguments.length; i++) { post(); post(arguments[i]) }
}

var last_debug = 0
function post_debug_limited() {
  if (!debug) return
  if (Math.abs(Date.now() - last_debug) < DEBUG_FREQ) return
  if (arguments.length == 0) post()
  for (var i = 0; i < arguments.length; i++) { post(); post(arguments[i]) }
  last_debug = Date.now()
}
