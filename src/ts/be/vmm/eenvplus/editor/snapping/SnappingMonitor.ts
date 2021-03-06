///ts:ref=Module
/// <reference path="../../Module.ts"/> ///ts:ref:generated

module be.vmm.eenvplus.editor.snapping {
    'use strict';

    /** Determines snapping possibilities of the current mouse position and signals changes in this information. */
    export interface SnappingMonitor {
        /** Fires as long as the mouse moves within snapping range of an end point. */
        moveAtEnd:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;
        /** Fires as long as the mouse moves within snapping range of a starting point. */
        moveAtStart:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;
        /** Fires as long as the mouse moves outside of snapping range of any point. */
        moveOutside:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;
        /** Fires when the mouse moves into snapping range of an end point. */
        snapInEnd:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;
        /** Fires when the mouse moves into snapping range of a starting point. */
        snapInStart:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;
        /** Fires when the mouse moves out of snapping range of an end point. */
        snapOutEnd:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;
        /** Fires when the mouse moves out of snapping range of a starting point. */
        snapOutStart:Trasys.Signals.ITypeSignal<SnappingPointerEvent>;

        /**
         * Reset the monitor to its initial state.
         * This is necessary because we use a single instance of SnappingMonitor in multiple snapping
         * strategy instances. When a strategy is activated, we need to be sure that we don't start with the state of
         * the previously used strategy.
         */
        reset():void;
        /**
         * Pass mouse move events into the monitor for analysis.
         *
         * @param event
         * @param atStart
         * @param atEnd If not provided, it defaults to the inverse of `atStart`.
         */
        update(event:ol.MapBrowserPointerEvent, atStart:atCoordinateFn, atEnd?:atCoordinateFn):ol.Coordinate;
    }

    /** Contains information pertaining to snapping possibilities of the current mouse position. */
    interface SnappingInfo {
        /** A clone of the original `MapBrowserPointerEvent#coorindate` */
        mouseCoordinate:ol.Coordinate;
        /** The calculated Coordinate to snap to. */
        snappedCoordinate:ol.Coordinate;
        /** Whether the mouse is in snapping range of a starting point. */
        start:boolean;
        /** Whether the mouse is in snapping range of an end point. */
        end:boolean;
    }

    /** An `ol.MapBrowserPointerEvent` enriched with the information from SnappingInfo.*/
    export interface SnappingPointerEvent extends ol.MapBrowserPointerEvent, SnappingInfo {
    }

    export interface atCoordinateFn {
        (coordinate?:ol.Coordinate):boolean;
    }

    export module SnappingMonitor {
        export var NAME:string = PREFIX + 'SnappingMonitor';

        factory.$inject = ['epMap', 'epSnappingStore', 'epFeatureManager'];

        function factory(map:ol.Map, store:SnappingStore, featureManager:feature.FeatureManager):SnappingMonitor {
            var nodes:ol.source.Vector,
                toPixel = map.getPixelFromCoordinate.bind(map),
                inStartRange:boolean = false,
                inEndRange:boolean = false;

            var signal = {
                moveAtStart: new Trasys.Signals.TypeSignal(),
                moveAtEnd: new Trasys.Signals.TypeSignal(),
                moveOutside: new Trasys.Signals.TypeSignal(),
                snapInStart: new Trasys.Signals.TypeSignal(),
                snapOutStart: new Trasys.Signals.TypeSignal(),
                snapInEnd: new Trasys.Signals.TypeSignal(),
                snapOutEnd: new Trasys.Signals.TypeSignal()
            };

            return _.merge({
                update: update,
                reset: reset
            }, signal);

            /** @see SnappingMonitor#reset */
            function reset():void {
                inStartRange = inEndRange = false;
            }

            /** @see SnappingMonitor#update */
            function update(event:ol.MapBrowserPointerEvent, atStart:atCoordinateFn, atEnd?:atCoordinateFn):void {
                if (!nodes) nodes = feature.getLayer(map, feature.FeatureType.NODE).getSource();

                var snappingInfo = getSnappingInfo(event.coordinate, atStart, atEnd || _.constant(true));
                invalidateState(snappingInfo, event);
            }

            /**
             * Calculate the snapping information for the current mouse Coordinate:
             * we snap only to Nodes, so find the Node that is closest to the mouse,
             * ignoring the ones that coincide with the drawing's starting Coordinate,
             * and compare its distance to the snapping resolution.
             *
             * @param mouseCoordinate
             * @param atStartFn
             * @param atEndFn
             * @returns An object with snapping information.
             */
            function getSnappingInfo(mouseCoordinate:ol.Coordinate,
                                     atStartFn:atCoordinateFn,
                                     atEndFn:atCoordinateFn):SnappingInfo {

                var closestNodeCoordinate = firstCoordinate(getClosestNode(mouseCoordinate)),
                    atStart = inStartRange || atStartFn(closestNodeCoordinate),
                    atEnd = inEndRange || !atStart && atEndFn(closestNodeCoordinate),
                    pixels = [mouseCoordinate, closestNodeCoordinate].map(toPixel),
                    distance = Math.sqrt(apply(ol.coordinate.squaredDistance)(pixels)),
                    snapping = distance <= store.resolution;

                return {
                    mouseCoordinate: _.clone(mouseCoordinate),
                    snappedCoordinate: snapping ? closestNodeCoordinate : mouseCoordinate,
                    start: atStart && snapping,
                    end: atEnd && snapping
                };
            }

            /**
             * A copy of `ol.source.Vector#getClosestFeatureToCoordinate` that adds the ability to filter out
             * connected nodes while scanning.
             *
             * @param coordinate
             * @returns {ol.Feature}
             * @see ol.source.Vector#getClosestFeatureToCoordinate
             */
            function getClosestNode(coordinate:ol.Coordinate):ol.Feature {
                var x = coordinate[0],
                    y = coordinate[1],
                    closestNode:ol.Feature = null,
                    closestPoint = <ol.Coordinate> [NaN, NaN],
                    minSquaredDistance = Infinity,
                    extent = <ol.Coordinate> [-Infinity, -Infinity, Infinity, Infinity],
                    connectedNodeIds = featureManager.getConnectedNodeIds();

                nodes.forEachFeatureInExtent(extent, (node:ol.Feature):void => {
                    if (_.contains(connectedNodeIds, node.getId())) return;

                    var geometry = node.getGeometry(),
                        previousMinSquaredDistance = minSquaredDistance;

                    minSquaredDistance = geometry.closestPointXY(x, y, closestPoint, minSquaredDistance);

                    if (minSquaredDistance < previousMinSquaredDistance) {
                        closestNode = node;

                        var minDistance = Math.sqrt(minSquaredDistance);
                        extent[0] = x - minDistance;
                        extent[1] = y - minDistance;
                        extent[2] = x + minDistance;
                        extent[3] = y + minDistance;
                    }
                });

                return closestNode;
            }

            /**
             * Determine the current state based on the given SnappingInfo and signal changes to all listeners.
             *
             * @param snappingInfo
             * @param originalEvent
             */
            function invalidateState(snappingInfo:SnappingInfo, originalEvent:ol.MapBrowserPointerEvent):void {
                var event = _.merge(originalEvent, snappingInfo);

                if (inStartRange && !snappingInfo.start) {
                    signal.snapOutStart.fire(event);
                    inStartRange = false;
                }
                else if (inEndRange && !snappingInfo.end) {
                    signal.snapOutEnd.fire(event);
                    inEndRange = false;
                }

                if (snappingInfo.start) {
                    if (!inStartRange) {
                        signal.snapInStart.fire(event);
                        inStartRange = true;
                    }
                    signal.moveAtStart.fire(event);
                }
                else if (snappingInfo.end) {
                    if (!inEndRange) {
                        signal.snapInEnd.fire(event);
                        inEndRange = true;
                    }
                    signal.moveAtEnd.fire(event);
                }
                else signal.moveOutside.fire(event);
            }

            /**
             * @param olFeature
             * @returns The first Coordinate of the given Feature. A NaN Coordinate if the Feature is undefined.
             */
            function firstCoordinate(olFeature:ol.Feature):ol.Coordinate {
                return olFeature ?
                    (<ol.geometry.SimpleGeometry> olFeature.getGeometry()).getFirstCoordinate() :
                    [NaN, NaN];
            }

        }

        angular
            .module(MODULE)
            .factory(NAME, factory);
    }

}
