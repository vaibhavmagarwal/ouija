$(function() {
  var input_date = location.search.substr(1).split('=')[1];

  $error = $("#error"),
  $body = $("body");


  function loadDate(date) {
    var parts = date.split('/');
    var d = parts[2] + '-' + parts[0] + '-' + parts[1];
    printTable(d);
  }

  function createDates(data) {
    var dates = {}

    //NOTE: dates are in: "2015-01-01 00:00:00" format
    var previous_value = 0;
    var last_date = '';
    for(var val in data) {
      var date = val.split(' ')[0];
      last_date = date;
      var current_value = data[val];

      //TODO: consider doing something different for more/less values
      if (current_value != previous_value) {
        var parts = date.split('-');
        date = parts[1] + '/' + parts[2] + '/' + parts[0];
        dates[new Date(date)] = new Date(date);
      }
      previous_value = current_value;
    }

    $(function() {
      $("#datepicker").datepicker({
        numberOfMonths: 3,
        minDate: new Date(2014, 11-1, 14),
        showButtonPanel: false,
        showOtherMonths: true,
        selectOtherMonths: true,
        onSelect: loadDate,
        beforeShowDay: function(date) {
          var annotated = dates[date];
          if (annotated) {
            return [true, 'annotated', ''];
          } else {
            return [true, '', ''];
          }
        }
      });
    });

    $("#datepicker").datepicker("setDate", "-2m");

    document.getElementById("toggle").addEventListener("click", toggleState);

    if (input_date === undefined || input_date === '') {
      printTable(last_date);
    } else {
      printTable(input_date);
    }
  }

  function printTable(date) {
    $.getJSON("/data/setadetails/", {date:date}).done(function (data) { getActiveJobs(data, date); });
  }

  function getActiveJobs(details, date) {
    $.getJSON("/data/jobtypes/").done(function (data) { outputTable(data, details, date); });
  }

  // Simple text replace of full names -> Group-Code format
  function printName(testname) {
    var retVal = testname.replace(/mochitest-browser-chrome[-]?/, 'M-bc');
    retVal = retVal.replace(/mochitest-e10s-browser-chrome[-]?/, 'Me10s-bc');
    retVal = retVal.replace(/mochitest-e10s-devtools-chrome[-]?/, 'M-dt');
    retVal = retVal.replace('mochitest-e10s', 'Me10s');
    retVal = retVal.replace(/mochitest-devtools-chrome[-]?/, 'M-dt');
    retVal = retVal.replace('mochitest-other', 'M-oth');
    retVal = retVal.replace('mochitest', 'M');
    retVal = retVal.replace('crashtest-ipc', 'R-C-ipc');
    retVal = retVal.replace('crashtest', 'R-C');
    retVal = retVal.replace('jsreftest', 'R-J');
    retVal = retVal.replace('reftest-no-accel', 'R-RU');
    retVal = retVal.replace('reftest-e10s', 'Re10s-R');
    retVal = retVal.replace('reftest', 'R-R');
    retVal = retVal.replace('xpcshell', 'O-X');
    retVal = retVal.replace('marionette', 'O-Mn');
    retVal = retVal.replace('cppunit', 'O-Cpp');
    retVal = retVal.replace(/jittest[-]?/, 'O-Jit');
    retVal = retVal.replace('web-platform-tests', 'WPT');
    return retVal;
  }

  function fixPlatform(plat) {
    retVal = plat.replace('osx10.6', 'osx-10-6');
    retVal = retVal.replace('osx10.8', 'osx-10-8');
    retVal = retVal.replace('winxp', 'windowsxp');
    retVal = retVal.replace('win7', 'windows7-32');
    retVal = retVal.replace('win8', 'windows8-64');

    return retVal
  }

  function toggleState() {
    item = document.getElementById("toggle");
    fetchData();
    if (item.value == "Show Optional Jobs") {
      item.value = "Hide Optional Jobs";
    } else {
      item.value = "Show Optional Jobs";
    }
  }

  // determine if we need a strike through or not
  function printableJobCode(rawName, partName, osMap) {
    item = document.getElementById("toggle");
    // when item.value == "Hide Optional Jobs", its true value is to "show".
    if (item.value == "Hide Optional Jobs") {
      if (osMap.indexOf(rawName) >= 0) {
        return "<span style='background: white; color: #444039;'>" + partName + " </span>";
      }
    }
    if (!(osMap.indexOf(rawName) >= 0)) {
      return "<span style='background: white; color: black; font-weight: 14px;'><b>" + partName + " </b></span>";
    }
  }

  function buildOSJobMap(joblist) {
    var map = {}

    for (var i = 0; i < joblist.length; i++) {
      var job = joblist[i];
      key = fixPlatform(job[0]) + " " + job[1];
      if (map[key] === undefined) {
          map[key] = [];
      }
      map[key].push(job[2]);
    }
    return map;
  }

  function outputTable(active_jobs, details, date) {
    // Get the list of jobs per platform that we don't need to run
    var optional_jobs = buildOSJobMap(details['jobtypes'][date]);

    var keys = []
    for (var key in optional_jobs) {
      keys.push(key);
    }
    if (keys.length == 0) {
      $('#datedesc').replaceWith('<div id="datedesc"><p><h3>Sorry, there is no data for the day ' + date + "</h3></div>");
      $('#seta').html('<table id="seta" border=0></table>');
      return;
    }

    // Get a list of all the active jobs on the tree
    var active_osjobs = buildOSJobMap(active_jobs['jobtypes']);

    var active_oslist = ['linux32 opt', 'linux32 debug',
                         'linux64 opt', 'linux64 asan', 'linux64 debug',
                         'osx-10-6 opt', 'osx-10-6 debug',
                         'osx-10-8 opt', 'osx-10-8 debug',
                         'windowsxp opt', 'windowsxp debug',
                         'windows7-32 opt', 'windows7-32 debug',
                         'windows8-64 opt', 'windows8-64 debug'];

    var mytable = $('#seta');
    var desc = "This is the list of jobs that would be required to run in order to catch every regression in the last 6 months";
    if (mytable.html() === undefined) {
      mytable = $('#seta');
    } else {
      mytable.html('<table id="seta" border=0></table>');
    }
    $('#datedesc').replaceWith('<div id="datedesc">' + date + " - " + desc + "</div>");
    total_jobs = 0;
    ignore_jobs = 0;

    // Iterate through each OS, add a row and colums
    for (var i = 0; i < active_oslist.length; i++) {
      var os = active_oslist[i];
      var row = $('<tr></tr>').appendTo(mytable);
      $('<td></td>').text(os).appendTo(row);
      var td_jobs = $('<td></td>').appendTo(row);
      var td_div = $('<div style="float: left"></div>').appendTo(td_jobs);

      var types = { 'O': {'group': 'O'},
                    'M': {'group': 'M'}, "Me10s": {'group': 'M-e10s'},
                    'R': {'group': 'R'}, 'Re10s': {'group': 'R-e10s'},
                    'WPT': {'group': 'W'}}

      for (var type in types) {
          types[type]['div'] = $('<span></span>').html('').appendTo(td_div);
      }

      // Iterate through all jobs for the given OS, find a group and code
      active_osjobs[os].sort();
      total_jobs += active_osjobs[os].length;
      ignore_jobs += optional_jobs[os].length;
      for (var j = 0; j < active_osjobs[os].length; j++) {
        var jobparts = printName(active_osjobs[os][j]).split('-', 2);
        var group = jobparts[0];
        var jobcode = jobparts[1];

        if (group in types) {
          $('<span></span>').html(printableJobCode(active_osjobs[os][j], jobcode, optional_jobs[os])).appendTo(types[group]['div']);
        } else {
          alert("couldn't find matching group: " + group + ", with code: " + jobcode);
        }
      }

      // remove empty groups, add group letter and () for visual grouping
      for (var type in types) {
        var leftover = types[type]['div'].html().replace(/\<\/span\>/g, '');
        leftover = leftover.replace(/\<span\>/g, '');

        if (leftover.replace(/ /g, '') == '') {
            types[type]['div'].html('');
        } else if (type != 'O') {
           types[type]['div'].html(types[type]['group'] + '(' + leftover.replace(/\s+$/g, '') + ') ');
        }
      }

    }

    var ignore = "Jobs to ignore: " + ignore_jobs
    var remaining = "Jobs to run: " + (total_jobs - ignore_jobs);
    var total = "Total number of jobs: " + total_jobs;
    $('#jobs_number').replaceWith('<div id="jobs_number">'+ignore+"<br>"+remaining+"<br>"+total+"<div>");

    if (!($('#seta').length)) {
      mytable.appendTo('body');
    } else {
      $('#seta').replaceWith(mytable);
    }

  }

  function gotsummary(data) {
    if ($error.is(":visible")) $error.hide();
    createDates(data.dates);
  }

  function fail(error) {
    $dates.hide();
    $error.text(error).show();
  }

  function fetchData(e) {
    if (e) e.preventDefault();
    $.getJSON("/data/setasummary/").done(gotsummary).fail(fail);
  }

  $(document).on("ajaxStart ajaxStop", function (e) {
    (e.type === "ajaxStart") ? $body.addClass("loading") : $body.removeClass("loading");
  });

  fetchData();

});
