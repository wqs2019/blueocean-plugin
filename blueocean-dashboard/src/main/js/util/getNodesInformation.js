import { capable } from '@jenkins-cd/blueocean-core-js';
import { RESULTS, STATES } from './logDisplayHelper'; // TODO: Remove this keymirror rubbish

/*

 Fields that appear to be used, based on proxy recording:

    isFocused
    id
    durationInMillis
    startTime
    state
    result
    displayName
    type
    edges
    firstParent
    _links
    parent
    isParallel
    actions
    isRunning
    restartable
    title

 */

function isRunningNode(item) {
    return item.state === STATES.RUNNING || item.state === STATES.PAUSED;
}

const proxyProps = {};
const proxyHandler = {
    get: function(obj, prop) {
        proxyProps[prop] = prop;
        console.log('AnnotatedStage', Object.keys(proxyProps));
        return obj[prop];
    },
};

function debugNodes(nodes) {
    // TODO: RM
    const stats = [];

    for (const node of nodes) {
        const { id, result, state, type, firstParent } = node;
        const edges = node.edges.map(o => o.id + ' - ' + o.type).join(', ');
        const name = node.displayName;
        stats.push({
            id,
            name,
            result,
            state,
            type,
            firstParent,
            edges,
        });
    }

    // console.log(JSON.stringify(stats,null,4));
    console.table(stats);
}

export function getNodesInformationForStages(nodes) {
    // TODO: fix this flamin' mess somehow

    console.log('getNodesInformationForStages'); // TODO: RM
    debugNodes(nodes);

    // calculation of information about stages
    // nodes in Running state
    const runningNodes = nodes.filter(item => isRunningNode(item) && (!item.edges || item.edges.length < 2)).map(item => item.id);
    // nodes with error result
    const errorNodes = nodes.filter(item => item.result === RESULTS.FAILURE).map(item => item.id);
    const queuedNodes = nodes.filter(item => item.state === null && item.result === null).map(item => item.id);
    // nodes without information
    const hasResultsForSteps = nodes.filter(item => item.state === null && item.result === null).length !== nodes.length;
    // principal model mapper
    let wasFocused = false; // we only want one node to be focused if any
    let parent;
    // a job that is in queue would be marked as finished since
    // there will be no running nodes yet, that is why we check for that
    const finished = runningNodes.length === 0 && queuedNodes.length !== nodes.length;
    const error = !(errorNodes.length === 0);
    const model = nodes.map((item, index) => {
        const hasFailingNode = item.edges && item.edges.length >= 2 ? item.edges.filter(itemError => errorNodes.indexOf(itemError.id) > -1).length > 0 : false;
        const isFailingNode = errorNodes.indexOf(item.id) > -1;
        const isRunning = runningNodes.indexOf(item.id) > -1;

        const isParallel = item.type === 'PARALLEL';

        const logActions = item.actions ? item.actions.filter(action => capable(action, 'org.jenkinsci.plugins.workflow.actions.LogAction')) : [];
        const hasLogs = logActions.length > 0;
        const isCompleted = item.result !== 'UNKNOWN' && item.result !== null;
        const computedResult = isCompleted ? item.result : item.state;
        const isInputStep = item.input && item.input !== null;
        const key = index + isRunning + computedResult;
        const title = item.displayDescription ? item.displayName + ': ' + item.displayDescription : item.displayName;
        const modelItem = {
            actions: item.actions,
            _links: item._links,
            key: key || undefined,
            id: item.id,
            edges: item.edges,
            type: item.type,
            displayName: item.displayName,
            displayDescription: item.displayDescription,
            title: title || `runId: ${item.id}`,
            durationInMillis: item.durationInMillis || undefined,
            startTime: item.startTime || undefined,
            result: item.result || undefined,
            state: item.state || undefined,
            restartable: item.restartable,
            hasLogs,
            logUrl: hasLogs ? logActions[0]._links.self.href : undefined,
            isParallel,
            parent,
            firstParent: item.firstParent || undefined,
            isRunning,
            isCompleted,
            computedResult,
            isInputStep,
        };
        // do not set the parent node in parallel, since we already have this information
        if (!isParallel) {
            parent = item.id;
        }
        if (item.type === 'WorkflowRun') {
            modelItem.estimatedDurationInMillis = item.estimatedDurationInMillis;
            modelItem.isMultiBranch = true;
        }
        if ((isRunning || (isFailingNode && !hasFailingNode && finished)) && !wasFocused) {
            wasFocused = true;
            modelItem.isFocused = true;
        }
        if (isInputStep) {
            modelItem.input = item.input;
        }
        // return new Proxy(modelItem, proxyHandler);
        return modelItem;
    });
    // in case we have all null we will focus the first node since we assume that this would
    // be the next node to be started
    if (queuedNodes.length === nodes.length && !wasFocused && model[0]) {
        model[0].isFocused = true;
    }

    // debugNodes(model);
    // console.log('\n\n\n---------------------------\n\n\n'); // TODO: RM

    console.log('updated model has', model.length, 'stages'); // TODO: RM

    // creating the response object
    const information = {
        isFinished: finished,
        hasResultsForSteps,
        model,
    };
    // on not finished we return null and not a bool since we do not know the result yet
    if (!finished) {
        information.isError = null;
    } else {
        information.isError = error;
    }
    if (!finished) {
        information.runningNodes = runningNodes;
    } else if (error) {
        information.errorNodes = errorNodes;
    }
    return information;
}
