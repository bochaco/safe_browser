import path from 'path';
// import {LIB_PATH} from '../constants';
const crypto = require( 'crypto' ); // electron deps will be available inside browser
const { Readable } = require( 'stream' );

const handles = new Map();
const LIB_PATH = path.resolve( __dirname, '../../../node_modules/@maidsafe/safe-node-app/src/native' );

export const genRandomString = () => ( crypto.randomBytes( 32 ).toString( 'hex' ) );

const genObjHandle = ( obj ) =>
{
    const randHandle = genRandomString();
    handles.set( randHandle, obj );
    return randHandle;
};

export const genHandle = ( app, netObj, groupId ) =>
{
    const obj = {
        app,
        netObj, // this is null if the handle corresponds to a safeApp instance
        groupId // groupId is only set for safeApp instances
    };
    return genObjHandle( obj );
};

export const getObj = ( handle, supportNull ) =>
    new Promise( ( resolve, reject ) =>
    {
        if ( supportNull && handle === null )
        {
            return resolve( { app: null, netObj: null } );
        }

        const obj = handles.get( handle );
        if ( obj )
        {
            return resolve( obj );
        }
        return reject( new Error( `Invalid handle: ${handle}` ) );
    } );

export const freeObj = ( handle, forceCleanCache ) =>
{
    const obj = handles.get( handle );
    if ( obj )
    {
        handles.delete( handle );
        // Check if we are freeing a SAFEApp instance, if so, cascade the deletion
        // to all objects created with this SAFEApp instance.
        if ( obj.netObj === null )
        {
            handles.forEach( ( value, key, map ) =>
            {
                if ( obj.app === value.app )
                {
                    // Current object was created with this SAFEApp instance,
                    // thus let's free it too.
                    freeObj( key );
                }
            } );

            // Make sure that any resources allocated are freed, e.g. safe_app lib
            // objects. We rely on the safe_client_lib to automatically free these all
            // objects creted with this safeApp instance when the safeApp's resources
            // are released.
            if ( obj.app.forceCleanUp )
            {
                try
                {
                    obj.app.forceCleanUp();
                }
                catch ( err )
                {
                    // Since there was an error, assume the safeApp obj was not released,
                    // restore it to the handles cache since it may be either used again
                    // by the app, unless we are actually freeing all objects
                    // due to the tab being closed or refreshed.
                    if ( !forceCleanCache )
                    {
                        handles.set( handle, obj );
                    }
                }
            }
        }
    }
};

export const freePageObjs = ( groupId ) =>
{
    if ( groupId !== null )
    {
    // Let's find all SAFEApp instances created under this groupId
        handles.forEach( ( value, key, map ) =>
        {
            if ( value.groupId === groupId )
            {
                // Current SAFEApp instance was created in this page, thus let's free it
                // along with any other obects created with this SAFEApp instance.
                freeObj( key, true );
            }
        } );
    }
};

export const forEachHelper = ( containerHandle, sendHandles ) =>
{
    const readable = new Readable( { objectMode : true,
        read()
        {} } );
    getObj( containerHandle )
        .then( ( obj ) => obj.netObj.forEach( ( arg1, arg2 ) =>
        {
            setImmediate( () =>
            {
                if ( sendHandles )
                {
                    arg1 = genHandle( obj.app, arg1 );
                }
                const args = [arg1];
                if ( arg2 )
                {
                    if ( sendHandles )
                    {
                        arg2 = genHandle( obj.app, arg2 );
                    }
                    args.push( arg2 );
                }
                readable.push( args );
            } );
        } )
            .then( () =>
            {
                setImmediate( () =>
                {
                    readable.push( null );
                } );
            } )
        )
        .catch( ( err ) =>
        {
            setImmediate( () =>
            {
                readable.emit( 'error', err );
                readable.push( null );
            } );
        } );
    return readable;
};

export const netStateCallbackHelper = ( safeApp, appInfo, enableLog, groupId ) =>
{
    const readable = new Readable( { objectMode : true,
        read()
        {} } );
    safeApp.initializeApp( appInfo, ( state ) =>
    {
        setImmediate( () =>
        {
            readable.push( [state] );
        } );
    }, {
        log            : enableLog,
        registerScheme : false,
        libPath        : LIB_PATH
    } )
        .then( ( app ) =>
        {
            const handle = genHandle( app, null, groupId ); // We assign null to 'netObj' to signal this is a SAFEApp instance
            setImmediate( () =>
            {
                readable.push( [handle] );
            } );
        } )
        .catch( ( err ) =>
        {
            setImmediate( () =>
            {
                readable.emit( 'error', err );
                readable.push( null );
            } );
        } );

    return readable;
};
