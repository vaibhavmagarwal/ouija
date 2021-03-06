import argparse
import re
import MySQLdb
import datetime
import sys
import time
import logging
from threading import Thread
from Queue import Queue

import requests

branch_paths = {
    'mozilla-central': 'mozilla-central',
    'mozilla-inbound': 'integration/mozilla-inbound',
    'b2g-inbound': 'integration/b2g-inbound',
    'fx-team': 'integration/fx-team',
    'try': 'try',
}

branches = [
    'mozilla-central',
    'mozilla-inbound',
    'b2g-inbound',
    'fx-team',
    'try'
]


class Worker(Thread):

    def __init__(self, queue, **kargs):
        Thread.__init__(self, **kargs)
        self.queue = queue
        self.daemon = True

    def run(self):
        while True:
            job_spec = self.queue.get()
            try:
                self.do_job(job_spec)
            except:
                logging.exception('Error in %s', self.name)
            finally:
                self.queue.task_done()

class Downloader(Worker):

    def __init__(self, download_queue, **kargs):
        Worker.__init__(self, download_queue, **kargs)

    def do_job(self, job_spec):
        branch, revision, date = job_spec
        logging.info("%s: %s - %s", self.name, revision, date)
        data = getCSetResults(branch, revision)
        uploadResults(data, branch, revision, date)


def getResultSetID(branch, revision):
    url = "https://treeherder.mozilla.org/api/project/%s/resultset/?format=json&full=true&revision=%s&with_jobs=true" % (branch, revision)
    try:
        response = requests.get(url, headers={'accept-encoding':'gzip'}, verify=True)
        cdata = response.json()
        return cdata
    except SSLError:
        pass

def getCSetResults(branch, revision):
    """
      https://tbpl.mozilla.org/php/getRevisionBuilds.php?branch=mozilla-inbound&rev=3435df09ce34

      no caching as data will change over time.  Some results will be in asap, others will take
      up to 12 hours (usually < 4 hours)
    """

    rs_data = getResultSetID(branch, revision)
    results_set_id = rs_data['results'][0]['id']
    url = "https://treeherder.mozilla.org/api/project/%s/jobs/?count=2000&result_set_id=%s&return_type=list" % (branch, results_set_id)
    try:
        response = requests.get(url, headers={'accept-encoding':'gzip'}, verify=True)
        cdata = response.json()
        return cdata
    except SSLError:
        pass

def getPushLog(branch, startdate):
    """
      https://hg.mozilla.org/integration/mozilla-inbound/pushlog?startdate=2013-06-19
    """

    url = "https://hg.mozilla.org/%s/pushlog?startdate=%04d-%02d-%02d&tipsonly=1" % (branch_paths[branch], startdate.year, startdate.month, startdate.day)
    response = requests.get(url, headers={'accept-encoding':'gzip'}, verify=True)
    data = response.content
    pushes = []
    csetid = re.compile('.*Changeset ([0-9a-f]{12}).*')
    dateid = re.compile('.*([0-9]{4}\-[0-9]{2}\-[0-9]{2})T([0-9\:]+)Z.*')
    push = None
    date = None
    for line in data.split('\n'):
        matches = csetid.match(line)
        if matches:
            push = matches.group(1)

        matches = dateid.match(line)
        if matches:
            ymd = map(int, matches.groups(2)[0].split('-'))
            hms = map(int, matches.groups(2)[1].split(':'))
            date = datetime.datetime(ymd[0], ymd[1], ymd[2], hms[0], hms[1], hms[2])

        if push and date and date >= startdate:
            pushes.append([push, date])
            push = None
            date = None
    return pushes

def clearResults(branch, startdate):

    date_xx_days_ago = datetime.date.today() - datetime.timedelta(days=180)
    delete_delta_and_old_data = 'delete from testjobs where branch="%s" and (date >= "%04d-%02d-%02d %02d:%02d:%02d" or date < "%04d-%02d-%02d")' % (branch, startdate.year, startdate.month, startdate.day, startdate.hour, startdate.minute, startdate.second, date_xx_days_ago.year, date_xx_days_ago.month, date_xx_days_ago.day)

    db = MySQLdb.connect(host="localhost",
                         user="root",
                         passwd="root",
                         db="ouija")

    cur = db.cursor()
    cur.execute(delete_delta_and_old_data)
    cur.close()

def uploadResults(data, branch, revision, date):
    db = MySQLdb.connect(host="localhost",
                         user="root",
                         passwd="root",
                         db="ouija")

    cur = db.cursor()

    if "job_property_names" not in data:
        return

    job_property_names = data["job_property_names"]
    i = lambda x: job_property_names.index(x)

    results = data['results']
    count = 0
    for r in results:
        _id, logfile, slave, result, duration, platform, buildtype, testtype, bugid = '', '', '', '', '', '', '', '', ''
        _id = r[i("id")]

        # Skip if result = unknown
        _result = r[i("result")]
        if _result == u'unknown':
            continue

        duration = '%s' % (int(r[i("end_timestamp")]) - int(r[i("start_timestamp")]))

        platform = r[i("platform")]
        if not platform:
            continue

        buildtype = r[i("platform_option")]
                   
        testtype = r[i("ref_data_name")].split()[-1]

        failure_classification = 0
        try:
            # https://treeherder.mozilla.org/api/failureclassification/
            failure_classification = int(r[i("failure_classification_id")])
        except ValueError:
            failure_classification = 0
        except TypeError:
            logging.warning("Error, failure classification id: expecting an int, but recieved %s instead" % r[i("failure_classification_id")])
            failure_classification = 0

        # Get Notes: https://treeherder.mozilla.org/api/project/mozilla-inbound/note/?job_id=5083103
        if _result != u'success':
            url = "https://treeherder.mozilla.org/api/project/%s/note/?job_id=%s" % (branch, _id)
            response = requests.get(url, headers={'accept-encoding':'json'}, verify=True)
            notes = response.json()
            if notes:
                bugid = notes[-1]['note']

        # https://treeherder.mozilla.org/api/project/mozilla-central/jobs/1116367/
        url = "https://treeherder.mozilla.org/api/project/%s/jobs/%s/" % (branch, _id)
        response = requests.get(url, headers={'accept-encoding':'gzip'}, verify=True)
        data1 = response.json()

        slave = data1['machine_name']

        if (len(data1.get("logs"))):
            logfile = data1.get("logs", [])[0].get("url", "")

        # Insert into MySQL Database
        sql = """insert into testjobs (log, slave, result,
                                       duration, platform, buildtype, testtype,
                                       bugid, branch, revision, date,
                                       failure_classification)
                             values ('%s', '%s', '%s', %s,
                                     '%s', '%s', '%s', '%s', '%s',
                                     '%s', '%s', %s)""" % \
              (logfile, slave, _result, \
               duration, platform, buildtype, testtype, \
               bugid, branch, revision, date, failure_classification)

        try:
            cur.execute(sql)
            count += 1
        except MySQLdb.IntegrityError:
            # we already have this job
            logging.warning("sql failed to insert, we probably have this job: %s" % sql)
            pass
    cur.close()
    logging.info("uploaded %s/(%s) results for rev: %s, branch: %s, date: %s" % (count, len(results), revision, branch, date))


def parseResults(args):
    download_queue = Queue()

    for i in range(args.threads):
        Downloader(download_queue, name="Downloader %s" % (i+1)).start()

    startdate = datetime.datetime.utcnow() - datetime.timedelta(hours=args.delta)

    if args.branch == 'all':
        result_branches = branches
    else:
        result_branches = [args.branch]

    for branch in result_branches:
        clearResults(branch, startdate)

    for branch in result_branches:
        revisions = getPushLog(branch, startdate)
        for revision, date in revisions:
            download_queue.put((branch, revision, date))

    download_queue.join()
    logging.info('Downloading completed')

    #Sometimes the parent may exit and the child is not immidiately killed.
    #This may result in the error like the following -
    #
    #Exception in thread DBHandler (most likely raised during interpreter shutdown):
    #Traceback (most recent call last):
    #File "/usr/lib/python2.7/threading.py", line 810, in __bootstrap_inner
    #File "updatedb.py", line 120, in run
    #File "/usr/lib/python2.7/Queue.py", line 168, in get
    #File "/usr/lib/python2.7/threading.py", line 332, in wait
    #: 'NoneType' object is not callable
    #
    #The following line works as a fix
    #ref : http://b.imf.cc/blog/2013/06/26/python-threading-and-queue/

    time.sleep(0.1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Update ouija database.')
    parser.add_argument('--branch', dest='branch', default='all',
                        help='Branch for which to retrieve results.')
    parser.add_argument('--delta', dest='delta', type=int, default=12,
                        help='Number of hours in past to use as start time.')
    parser.add_argument('--threads', dest='threads', type=int, default=1,
                        help='Number of threads to use.')
    args = parser.parse_args()
    if args.branch != 'all' and args.branch not in branches:
        print('error: unknown branch: ' + args.branch)
        sys.exit(1)
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("requests").setLevel(logging.WARNING)
    parseResults(args)
